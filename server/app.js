import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { digest, hashPassword, matches } from './auth.js';
import { projectScope, scope, taskJoin, taskScope } from './access.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const statuses = ['todo', 'doing', 'done'];
const priorities = ['low', 'normal', 'high'];

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function found(row) {
  if (!row) fail(404, 'Resource not found.');
  return row;
}
function id(value) {
  if (typeof value !== 'string' || !uuid.test(value)) fail(400, 'Invalid resource ID.');
  return value;
}
function text(value, max, min = 1) {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min)
    fail(400, 'A required field is missing or has an invalid length.');
  return value.trim();
}
function email(value) {
  const normalized = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail(400, 'Enter a valid email.');
  return normalized;
}
function choice(value, options) {
  if (!options.includes(value)) fail(400, 'Invalid option.');
  return value;
}
function flag(value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail(400, 'Invalid visibility.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(400, 'Enter a date in YYYY-MM-DD format.');
  return value;
}
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const tokenFrom = (req) => /(?:^|;\s*)agencydesk=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
const staffOnly = (actor) => {
  if (actor.role === 'client_user') fail(403, 'Agency staff access required.');
};
const adminOnly = (actor) => {
  if (actor.role !== 'agency_admin') fail(403, 'Agency admin access required.');
};

export function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.get('Sec-Fetch-Site') === 'cross-site') return next(Object.assign(new Error('Cross-site request.'), { status: 403 }));
      if (!req.is('application/json')) return next(Object.assign(new Error('JSON required.'), { status: 415 }));
      if (!req.body || Array.isArray(req.body))
        return next(Object.assign(new Error('A JSON object is required.'), { status: 400 }));
    }
    next();
  });

  function route(method, path, handler, authenticated = true) {
    app[method]('/api' + path, async (req, res) => {
      const result = await db.transaction(async (tx) => {
        if (method === 'get') await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        let actor;
        if (authenticated) {
          const token = tokenFrom(req);
          if (token) actor = await one(tx, `
            SELECT m.*, a.slug, a.name AS agency_name, p.email
            FROM sessions s JOIN memberships m USING (agency_id,person_id)
            JOIN agencies a ON a.id = m.agency_id JOIN people p ON p.id = m.person_id
            WHERE s.token_hash = $1 AND s.expires_at > now()`, [digest(token)]);
          if (!actor) fail(401, 'Sign in to continue.');
        }
        return handler(tx, req, actor);
      });
      const cookie = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };
      if (result.token) res.cookie('agencydesk', result.token, { ...cookie, maxAge: 28800000 });
      if (result.clear) res.clearCookie('agencydesk', cookie);
      if (result.download) {
        res.attachment(result.download.name);
        res.type('application/octet-stream').set('X-Content-Type-Options', 'nosniff');
        return res.send(Buffer.from(result.download.data));
      }
      return res.status(result.httpStatus ?? 200).json(result.body ?? result);
    });
  }

  route('post', '/login', async (tx, req) => {
    const { slug, password, portal } = req.body ?? {};
    const address = email(req.body?.email);
    choice(portal, ['staff', 'client']);
    if (typeof password !== 'string' || password.length > 128) fail(400, 'Invalid password.');
    const actor = await one(tx, `
      SELECT m.*, p.password_hash FROM memberships m JOIN people p ON p.id = m.person_id
      JOIN agencies a ON a.id = m.agency_id WHERE a.slug = $1 AND p.email = $2
      AND (m.role = 'client_user') = $3`, [text(slug, 80).toLowerCase(), address, portal === 'client']);
    if (!actor || !(await matches(password, actor.password_hash))) fail(401, 'Invalid sign-in details.');
    const oldToken = tokenFrom(req);
    if (oldToken) await tx.query('DELETE FROM sessions WHERE token_hash = $1', [digest(oldToken)]);
    const token = randomBytes(32).toString('hex');
    await tx.query("INSERT INTO sessions VALUES ($1,$2,$3,now()+interval '8 hours')",
      [digest(token), actor.agency_id, actor.person_id]);
    return { token, body: { ok: true } };
  }, false);

  route('get', '/me', (_tx, _req, actor) => actor);
  route('post', '/logout', async (tx, req) => {
    await tx.query('DELETE FROM sessions WHERE token_hash = $1', [digest(tokenFrom(req))]);
    return { clear: true, body: { ok: true } };
  });

  route('get', '/projects', (tx, _req, actor) => rows(tx, `
    SELECT p.id,p.name,c.name AS client_name FROM projects p JOIN clients c
    ON (c.agency_id,c.id) = (p.agency_id,p.client_id)
    WHERE ${projectScope} ORDER BY p.name`, scope(actor)));

  const getProject = async (tx, projectId, actor, lock = false) => {
    const args = [...scope(actor), id(projectId)];
    const query = `SELECT p.id,p.name FROM projects p WHERE ${projectScope} AND p.id=$5`;
    if (lock) found(await one(tx, query + ' FOR UPDATE OF p', args));
    return found(await one(tx, query, args));
  };

  const getTask = async (tx, taskId, actor, lock = false) => {
    const args = [...scope(actor), id(taskId)];
    const query = `SELECT t.* FROM ${taskJoin} WHERE ${taskScope} AND t.id=$5`;
    if (lock) found(await one(tx, query + ' FOR UPDATE OF p', args));
    return found(await one(tx, query, args));
  };

  route('get', '/clients', (tx, _req, actor) => {
    adminOnly(actor);
    return rows(tx, 'SELECT id,name FROM clients WHERE agency_id=$1 ORDER BY name', [actor.agency_id]);
  });
  route('post', '/clients', async (tx, req, actor) => {
    adminOnly(actor);
    return { httpStatus: 201, body: await one(tx, 'INSERT INTO clients VALUES ($1,$2,$3) RETURNING id,name',
      [actor.agency_id, randomUUID(), text(req.body.name, 120)]) };
  });
  route('post', '/projects', async (tx, req, actor) => {
    adminOnly(actor);
    const client = found(await one(tx, 'SELECT id FROM clients WHERE agency_id=$1 AND id=$2',
      [actor.agency_id, id(req.body.client_id)]));
    return { httpStatus: 201, body: await one(tx, 'INSERT INTO projects VALUES ($1,$2,$3,$4) RETURNING id,name',
      [actor.agency_id, randomUUID(), client.id, text(req.body.name, 120)]) };
  });

  route('get', '/projects/:projectId/tasks', async (tx, req, actor) => {
    const project = await getProject(tx, req.params.projectId, actor);
    const status = req.query.status ? choice(req.query.status, statuses) : null;
    const search = req.query.q === undefined ? '' : text(req.query.q, 120, 0);
    return rows(tx, `
      SELECT t.id,t.title,t.status,t.priority,t.due_date,t.visible,
        CASE WHEN $3='client_user' THEN NULL ELSE t.assignee_id END AS assignee_id
      FROM ${taskJoin} WHERE ${taskScope} AND p.id=$5
        AND ($6::text IS NULL OR t.status=$6) AND strpos(lower(t.title),lower($7)) > 0
      ORDER BY t.due_date NULLS LAST,t.title,t.id`, [...scope(actor), project.id, status, search]);
  });

  route('get', '/projects/:projectId/summary', async (tx, req, actor) => {
    const project = await getProject(tx, req.params.projectId, actor);
    const args = [...scope(actor), project.id];
    const counts = await rows(tx, `
      SELECT t.status,count(*)::int AS count FROM ${taskJoin}
      WHERE ${taskScope} AND p.id=$5 GROUP BY t.status`, args);
    const { minutes } = await one(tx, `
      SELECT coalesce(sum(e.minutes),0)::text AS minutes FROM ${taskJoin}
      JOIN time_entries e ON (e.agency_id,e.task_id)=(t.agency_id,t.id)
      WHERE ${taskScope} AND p.id=$5 AND ($3 <> 'client_user' OR e.visible)`, args);
    return { counts: { todo: 0, doing: 0, done: 0, ...Object.fromEntries(counts.map(({status,count}) => [status,count])) },
      hours: Number(minutes) / 60 };
  });

  route('post', '/projects/:projectId/tasks', async (tx, req, actor) => {
    staffOnly(actor);
    const project = await getProject(tx, req.params.projectId, actor, true);
    const body = req.body;
    const assignee = body.assignee_id ? id(body.assignee_id) : null;
    if (assignee) found(await one(tx, 'SELECT 1 FROM project_staff WHERE agency_id=$1 AND project_id=$2 AND person_id=$3',
      [actor.agency_id, project.id, assignee]));
    return { httpStatus: 201, body: await one(tx, `
      INSERT INTO tasks (agency_id,project_id,id,title,status,priority,due_date,assignee_id,visible)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title`,
      [actor.agency_id,project.id,randomUUID(),text(body.title,160),choice(body.status ?? 'todo',statuses),
        choice(body.priority ?? 'normal',priorities),body.due_date ? date(body.due_date) : null,assignee,flag(body.visible)]) };
  });

  route('patch', '/tasks/:taskId', async (tx, req, actor) => {
    staffOnly(actor);
    const task = await getTask(tx, req.params.taskId, actor, true);
    const body = req.body;
    const assignee = body.assignee_id === undefined ? task.assignee_id : body.assignee_id ? id(body.assignee_id) : null;
    if (assignee) found(await one(tx, 'SELECT 1 FROM project_staff WHERE agency_id=$1 AND project_id=$2 AND person_id=$3',
      [actor.agency_id, task.project_id, assignee]));
    return one(tx, `UPDATE tasks SET status=$3,assignee_id=$4,visible=$5
      WHERE agency_id=$1 AND id=$2 RETURNING id,status,assignee_id,visible`,
      [actor.agency_id,task.id,choice(body.status ?? task.status,statuses),assignee,
        body.visible === undefined ? task.visible : flag(body.visible)]);
  });

  route('get', '/tasks/:taskId', async (tx, req, actor) => {
    const task = await getTask(tx, req.params.taskId, actor);
    const args = [actor.agency_id, task.id, actor.role];
    const comments = await rows(tx, `SELECT c.id,c.body,c.visible,c.created_at,
      CASE WHEN $3='client_user' AND m.role<>'client_user' THEN 'Agency team' ELSE p.email END AS author
      FROM comments c JOIN people p ON p.id=c.author_id
      JOIN memberships m ON (m.agency_id,m.person_id)=(c.agency_id,c.author_id)
      WHERE c.agency_id=$1 AND c.task_id=$2 AND ($3 <> 'client_user' OR c.visible)
      ORDER BY c.created_at,c.id`, args);
    const files = await rows(tx, `SELECT id,name,visible,decision FROM files
      WHERE agency_id=$1 AND task_id=$2 AND ($3 <> 'client_user' OR visible) ORDER BY name`, args);
    const entries = actor.role === 'client_user' ? [] : await rows(tx,
      'SELECT id,minutes,note,logged_on,visible FROM time_entries WHERE agency_id=$1 AND task_id=$2 ORDER BY logged_on DESC',
      args.slice(0,2));
    delete task.agency_id;
    if (actor.role === 'client_user') delete task.assignee_id;
    return { task, comments, files, entries };
  });

  route('post', '/tasks/:taskId/comments', async (tx, req, actor) => {
    const task = await getTask(tx, req.params.taskId, actor, true);
    const comment = await one(tx, 'INSERT INTO comments (agency_id,task_id,id,author_id,body,visible) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [actor.agency_id,task.id,randomUUID(),actor.person_id,text(req.body.body,4000),
        actor.role === 'client_user' || flag(req.body.visible)]);
    return { httpStatus: 201, body: comment };
  });

  route('post', '/tasks/:taskId/time', async (tx, req, actor) => {
    staffOnly(actor);
    const task = await getTask(tx, req.params.taskId, actor, true);
    const { minutes, note, logged_on, visible } = req.body;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) fail(400, 'Enter 1 to 1440 minutes.');
    const entry = await one(tx, 'INSERT INTO time_entries VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [actor.agency_id,task.id,randomUUID(),actor.person_id,minutes,text(note,2000,0),date(logged_on),flag(visible)]);
    return { httpStatus: 201, body: entry };
  });

  route('post', '/tasks/:taskId/files', async (tx, req, actor) => {
    staffOnly(actor);
    const task = await getTask(tx, req.params.taskId, actor, true);
    const { name, base64, visible } = req.body;
    if (typeof base64 !== 'string' || base64.length > 6990508) fail(400, 'Upload a file up to 5 MB.');
    const data = Buffer.from(base64, 'base64');
    if (!data.length || data.length > 5242880 || data.toString('base64') !== base64)
      fail(400, 'Upload a valid file up to 5 MB.');
    const safeName = text(name, 200).replace(/[\/\\\x00-\x1f\x7f]/g, '_');
    const file = await one(tx, `INSERT INTO files (agency_id,task_id,id,name,data,visible)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name`,
      [actor.agency_id,task.id,randomUUID(),safeName,data,flag(visible)]);
    return { httpStatus: 201, body: file };
  });

  route('get', '/tasks/:taskId/files/:fileId', async (tx, req, actor) => {
    const task = await getTask(tx, req.params.taskId, actor);
    const file = await one(tx, `SELECT name,data FROM files WHERE agency_id=$1 AND task_id=$2 AND id=$3
      AND ($4 <> 'client_user' OR visible)`, [actor.agency_id,task.id,id(req.params.fileId),actor.role]);
    return { download: found(file) };
  });

  route('patch', '/tasks/:taskId/files/:fileId', async (tx, req, actor) => {
    if (actor.role !== 'client_user') fail(403, 'Client access required.');
    const task = await getTask(tx, req.params.taskId, actor, true);
    return found(await one(tx, `UPDATE files SET decision=$4 WHERE agency_id=$1 AND task_id=$2
      AND id=$3 AND visible RETURNING id,decision`,
      [actor.agency_id,task.id,id(req.params.fileId),choice(req.body.decision,['approved','needs_changes'])]));
  });

  route('get', '/projects/:projectId/staff', async (tx, req, actor) => {
    staffOnly(actor);
    const project = await getProject(tx, req.params.projectId, actor);
    return rows(tx, `SELECT m.person_id,p.email,m.role,(s.person_id IS NOT NULL) AS assigned
      FROM memberships m JOIN people p ON p.id=m.person_id LEFT JOIN project_staff s
      ON (s.agency_id,s.person_id,s.project_id)=(m.agency_id,m.person_id,$2)
      WHERE m.agency_id=$1 AND m.role <> 'client_user' AND ($3='agency_admin' OR s.person_id IS NOT NULL)
      ORDER BY p.email`, [actor.agency_id,project.id,actor.role]);
  });
  route('put', '/projects/:projectId/staff/:personId', async (tx, req, actor) => {
    adminOnly(actor);
    const project = await getProject(tx, req.params.projectId, actor, true);
    const membership = found(await one(tx, `SELECT person_id,role FROM memberships
      WHERE agency_id=$1 AND person_id=$2 AND role <> 'client_user'`,
      [actor.agency_id,id(req.params.personId)]));
    await tx.query('INSERT INTO project_staff VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [actor.agency_id,project.id,membership.person_id,membership.role]);
    return { ok: true };
  });
  route('delete', '/projects/:projectId/staff/:personId', async (tx, req, actor) => {
    adminOnly(actor);
    const project = await getProject(tx, req.params.projectId, actor, true);
    await tx.query('DELETE FROM project_staff WHERE agency_id=$1 AND project_id=$2 AND person_id=$3',
      [actor.agency_id,project.id,id(req.params.personId)]);
    return { ok: true };
  });

  route('post', '/invites', async (tx, req, actor) => {
    adminOnly(actor);
    const address = email(req.body.email);
    const client = found(await one(tx, 'SELECT id FROM clients WHERE agency_id=$1 AND id=$2',
      [actor.agency_id,id(req.body.client_id)]));
    const invite = await one(tx, `
      INSERT INTO invites VALUES ($1,$2,$3,$4,now()+interval '7 days',NULL)
      ON CONFLICT (agency_id,email) DO UPDATE SET
        id=CASE WHEN invites.expires_at<=now() THEN excluded.id ELSE invites.id END,
        expires_at=excluded.expires_at
      WHERE invites.accepted_at IS NULL AND invites.client_id=excluded.client_id
      RETURNING id`, [actor.agency_id,address,client.id,randomUUID()]);
    if (!invite) fail(409, 'This email has already been invited to another client or has accepted.');
    return { path: '/?invite=' + invite.id };
  });

  route('post', '/invites/accept', async (tx, req) => {
    const password = req.body.password;
    text(password,128,10);
    const invite = found(await one(tx, `
      SELECT i.*,a.slug FROM invites i JOIN agencies a ON a.id=i.agency_id
      WHERE i.id=$1 FOR UPDATE OF i`, [id(req.body.token)]));
    if (invite.accepted_at) return { ok: true, slug: invite.slug };
    if (new Date(invite.expires_at) <= new Date()) fail(410, 'Invite expired.');
    let person = await one(tx,'SELECT id,password_hash FROM people WHERE email=$1',[invite.email]);
    if (!person) {
      person = await one(tx,`INSERT INTO people VALUES ($1,$2,$3)
        ON CONFLICT (email) DO NOTHING RETURNING id,password_hash`,
        [randomUUID(),invite.email,await hashPassword(password)]);
      person ??= await one(tx,'SELECT id,password_hash FROM people WHERE email=$1',[invite.email]);
    }
    if (!(await matches(password,person.password_hash))) fail(401, 'Enter your existing account password.');
    await tx.query(`INSERT INTO memberships VALUES ($1,$2,'client_user',$3)
      ON CONFLICT DO NOTHING`, [invite.agency_id,person.id,invite.client_id]);
    const membership = await one(tx,'SELECT role,client_id FROM memberships WHERE agency_id=$1 AND person_id=$2',
      [invite.agency_id,person.id]);
    if (membership.role !== 'client_user' || membership.client_id !== invite.client_id)
      fail(409, 'This account already has a different membership in the agency.');
    await tx.query('UPDATE invites SET accepted_at=now() WHERE id=$1',[invite.id]);
    return { ok: true, slug: invite.slug };
  }, false);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Resource not found.' }));
  app.use((error, _req, res, _next) => {
    const constraint = ['23503','23514','22007','22008','22001'].includes(error.code);
    const status = error.status ?? (constraint ? 400 : 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? 'Unexpected server error.' :
      constraint ? 'A field value is invalid.' : error.message });
  });
  return app;
}
