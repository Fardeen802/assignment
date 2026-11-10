import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { demo as d, seed } from '../db/seed.js';

let db, server, origin, admin, client, member, field;
const task = (id) => '/tasks/' + id;
const project = (id) => '/projects/' + id;
const file = (taskId, fileId) => task(taskId) + '/files/' + fileId;

async function api(path, { cookie, method = 'GET', body = {}, expect = 200 } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  const res = await fetch(origin + '/api' + path, {
    method, headers, body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
  assert.equal(res.status, expect, method + ' ' + path + ' ' + JSON.stringify(data));
  return { data, cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
}
const get = async (cookie, path, expect = 200) => (await api(path,{cookie,expect})).data;
const write = async (cookie, method, path, body, expect = 200) => (await api(path,{cookie,method,body,expect})).data;
const login = (slug, email, portal, expect = 200, password = d.password) =>
  api('/login', { method: 'POST', body: { slug,email,portal,password }, expect });

before(async () => {
  // Use a dedicated, empty test database when TEST_DATABASE_URL is supplied.
  db = await openDatabase(process.env.TEST_DATABASE_URL || '', 'memory://');
  await seed(db);
  server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
  admin = (await login('northstar','admin@northstar.test','staff')).cookie;
  member = (await login('northstar','member@northstar.test','staff')).cookie;
  client = (await login('northstar','alex@example.test','client')).cookie;
  field = (await login('fieldwork','alex@example.test','staff')).cookie;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
});

test('tenant boundaries cover guessed IDs and database relationships', async () => {
  await get(undefined, '/projects', 401);
  assert.deepEqual((await get(field, '/projects')).map(p => p.id), [d.refresh]);
  for (const path of [task(d.refreshTask),project(d.refresh)+'/summary',project(d.refresh)+'/tasks',project(d.refresh)+'/staff'])
    await get(admin,path,404);
  await write(admin,'POST','/projects',{name:'Foreign',client_id:d.orbit},404);
  await write(admin,'POST','/invites',{email:'guess@example.test',client_id:d.orbit},404);
  await write(admin,'PATCH',task(d.refreshTask),{status:'done'},404);
  await write(admin,'POST',task(d.refreshTask)+'/files',{name:'bad',base64:'YQ=='},404);
  await write(admin,'POST',task(d.refreshTask)+'/time',{minutes:60},404);
  await write(admin,'PUT',project(d.refresh)+'/staff/'+d.member,{},404);
  await get(field,file(d.review,d.publicFile),404);
  await assert.rejects(db.transaction(tx => tx.query('INSERT INTO projects VALUES ($1,$2,$3,$4)',
    [d.north,randomUUID(),d.orbit,'Invalid tenant relationship'])), {code:'23503'});
  await assert.rejects(db.transaction(tx => tx.query('UPDATE tasks SET assignee_id=$3 WHERE agency_id=$1 AND id=$2',
    [d.north,d.review,d.shared])), {code:'23503'});
});

test('client list, search, direct detail, child resources, and totals share visibility rules', async () => {
  assert.deepEqual((await get(client,'/projects')).map(p => p.id),[d.retain,d.launch]);
  assert.deepEqual(await get(client,project(d.launch)+'/tasks?q=margin&status=todo'),[]);
  assert.deepEqual((await get(client,project(d.launch)+'/tasks?status=doing')).map(t=>t.id),[d.review]);
  await get(client,project(d.other)+'/summary',404);
  await get(client,task(d.privateTask),404);
  await get(client,file(d.privateTask,d.hiddenParentFile),404);
  await get(client,file(d.review,d.privateFile),404);
  await get(client,file(d.feedback,d.publicFile),404);
  await write(client,'PATCH',file(d.review,d.privateFile),{decision:'approved'},404);
  await write(client,'POST',task(d.privateTask)+'/comments',{body:'No access'},404);
  const detail = await get(client,task(d.review));
  assert.deepEqual(detail.files.map(f=>f.id),[d.publicFile]);
  assert.equal(detail.comments.length,1);
  assert.equal(detail.comments[0].author,'Agency team');
  assert.equal(detail.task.assignee_id,undefined);
  assert.deepEqual(detail.entries,[]);
  assert.deepEqual(await get(client,project(d.launch)+'/summary'),{counts:{todo:0,doing:1,done:1},hours:2});
  assert.deepEqual(await get(admin,project(d.launch)+'/summary'),{counts:{todo:1,doing:1,done:1},hours:3.5});
});

test('client can comment, download and approve, but cannot edit tasks or add time', async () => {
  await write(client,'POST',project(d.launch)+'/tasks',{title:'Unauthorized'},403);
  await write(client,'PATCH',task(d.review),{status:'done'},403);
  await write(client,'POST',task(d.review)+'/time',{},403);
  await write(client,'POST',task(d.review)+'/files',{},403);
  await write(client,'POST',task(d.review)+'/comments',{body:'Please enlarge the heading.',visible:false},201);
  const download = await api(file(d.review,d.publicFile),{cookie:client});
  assert.match(download.data,/Homepage concept/);
  assert.match(download.headers.get('content-disposition'),/^attachment/);
  for (const decision of ['needs_changes','approved'])
    assert.equal((await write(client,'PATCH',file(d.review,d.publicFile),{decision})).decision,decision);
  const detail = await get(admin,task(d.review));
  assert.equal(detail.files.find(f=>f.id===d.publicFile).decision,'approved');
  assert.equal(detail.comments.find(c=>c.body==='Please enlarge the heading.').visible,true);
});

test('one person signs into different agencies with independent roles and portal selection', async () => {
  const a = await get(client,'/me');
  const b = await get(field,'/me');
  assert.equal(a.person_id,b.person_id);
  assert.equal(a.role,'client_user');
  assert.equal(b.role,'agency_admin');
  assert.notEqual(a.agency_id,b.agency_id);
  await login('northstar','alex@example.test','staff',401);
  await login('fieldwork','alex@example.test','client',401);
});

test('concurrent resends and acceptances retain one invite and membership', async () => {
  const address = 'Invite@Example.Test';
  const requests = await Promise.all([address,address.toLowerCase()].map(email =>
    write(admin,'POST','/invites',{email,client_id:d.fern})));
  assert.equal(requests[0].path,requests[1].path);
  const token = new URL(requests[0].path,origin).searchParams.get('invite');
  await write(admin,'POST','/invites',{email:address,client_id:d.willow},409);
  await Promise.all([1,2].map(() => write(undefined,'POST','/invites/accept',{token,password:d.password})));
  await write(admin,'POST','/invites',{email:address,client_id:d.fern},409);
  const invited = (await login('northstar',address,'client')).cookie;
  assert.deepEqual((await get(invited,'/projects')).map(p=>p.id),[d.other]);
  await db.transaction(async tx => {
    for (const sql of [
      'SELECT count(*)::int n FROM people WHERE email=$1',
      'SELECT count(*)::int n FROM invites WHERE email=$1',
      'SELECT count(*)::int n FROM memberships JOIN people ON id=person_id WHERE email=$1',
    ]) assert.equal((await tx.query(sql,[address.toLowerCase()])).rows[0].n,1);
  });
});

test('existing identity needs its password to join another tenant', async () => {
  const {path} = await write(field,'POST','/invites',{email:'member@northstar.test',client_id:d.orbit});
  const token = new URL(path,origin).searchParams.get('invite');
  await write(undefined,'POST','/invites/accept',{token,password:'incorrect-password'},401);
  await write(undefined,'POST','/invites/accept',{token,password:d.password});
  const invited = (await login('fieldwork','member@northstar.test','client')).cookie;
  assert.equal((await get(invited,'/me')).person_id,d.member);
});

test('removal clears assignments atomically and revokes existing member sessions for that project', async () => {
  assert.deepEqual((await get(member,'/projects')).map(p=>p.id),[d.launch]);
  await get(member,project(d.retain)+'/tasks',404);
  const created = await write(member,'POST',project(d.launch)+'/tasks',
    {title:'Build homepage',assignee_id:d.member,visible:true,due_date:'2026-11-20'},201);
  await write(member,'PATCH',task(created.id),{status:'doing'});
  await write(member,'POST',task(created.id)+'/time',
    {minutes:45,note:'First pass',logged_on:'2026-11-10',visible:true},201);
  const uploaded = await write(member,'POST',task(created.id)+'/files',
    {name:'proof.txt',base64:'cHJvb2Y=',visible:true},201);
  assert.equal(await get(client,file(created.id,uploaded.id)),'proof');
  await write(admin,'DELETE',project(d.launch)+'/staff/'+d.member,{});
  await get(member,task(created.id),404);
  await write(member,'PATCH',task(created.id),{status:'done'},404);
  await write(admin,'PATCH',task(created.id),{assignee_id:d.member},404);
  const detail = await get(admin,task(created.id));
  assert.equal(detail.task.assignee_id,null);
  assert.equal(detail.task.status,'doing');
  assert.equal(detail.entries.length,1);
});
