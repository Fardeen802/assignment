import { pathToFileURL } from 'node:url';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const key = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const demo = {
  north: key(1), field: key(2), willow: key(11), fern: key(12), orbit: key(13),
  launch: key(21), retain: key(22), other: key(23), refresh: key(24),
  admin: key(31), member: key(32), shared: key(33),
  review: key(41), privateTask: key(42), feedback: key(43), otherTask: key(44), refreshTask: key(45),
  publicFile: key(51), privateFile: key(52), hiddenParentFile: key(53),
  password: 'agencydesk-demo',
};

export async function seed(db) {
  const d = demo;
  const hash = await hashPassword(d.password);
  await db.transaction(async (tx) => {
    // One transaction makes an interrupted seed safe to retry.
    const run = (sql, values) => tx.query(sql + ' ON CONFLICT DO NOTHING', values);
    await run('INSERT INTO agencies VALUES ($1,$2,$3),($4,$5,$6)',
      [d.north,'northstar','Northstar Studio',d.field,'fieldwork','Fieldwork Creative']);
    await run('INSERT INTO people VALUES ($1,$2,$7),($3,$4,$7),($5,$6,$7)',
      [d.admin,'admin@northstar.test',d.member,'member@northstar.test',d.shared,'alex@example.test',hash]);
    await run('INSERT INTO clients VALUES ($1,$2,$3),($1,$4,$5),($6,$7,$8)',
      [d.north,d.willow,'Willow & Co.',d.fern,'Fern Goods',d.field,d.orbit,'Orbit Labs']);
    await run(`INSERT INTO memberships VALUES ($1,$2,'agency_admin',NULL),
      ($1,$3,'agency_member',NULL),($1,$4,'client_user',$5),($6,$4,'agency_admin',NULL)`,
      [d.north,d.admin,d.member,d.shared,d.willow,d.field]);
    await run('INSERT INTO projects VALUES ($1,$2,$3,$4),($1,$5,$3,$6),($1,$7,$8,$9),($10,$11,$12,$13)',
      [d.north,d.launch,d.willow,'Website launch',d.retain,'Content retainer',d.other,d.fern,'Packaging rollout',
        d.field,d.refresh,d.orbit,'Brand refresh']);
    await run(`INSERT INTO project_staff VALUES ($1,$2,$3,'agency_member'),($1,$2,$4,'agency_admin')`,
      [d.north,d.launch,d.member,d.admin]);
    await run(`INSERT INTO tasks VALUES
      ($1,$2,$3,'Review homepage concepts','doing','high',CURRENT_DATE+3,$4,true),
      ($1,$2,$5,'Internal margin review','todo','high',CURRENT_DATE+1,$4,false),
      ($1,$2,$6,'Confirm launch milestones','done','normal',CURRENT_DATE-2,NULL,true),
      ($1,$7,$8,'Send packaging proofs','todo','normal',NULL,NULL,true),
      ($9,$10,$11,'Explore identity directions','todo','normal',NULL,NULL,true)`,
      [d.north,d.launch,d.review,d.member,d.privateTask,d.feedback,d.other,d.otherTask,d.field,d.refresh,d.refreshTask]);
    await run(`INSERT INTO comments (agency_id,task_id,id,author_id,body,visible) VALUES
      ($1,$2,$3,$4,'The first round is ready for your feedback.',true),
      ($1,$2,$5,$4,'Internal note: hold the second concept for the pitch.',false)`,
      [d.north,d.review,key(61),d.admin,key(62)]);
    await run(`INSERT INTO files (agency_id,task_id,id,name,data,visible) VALUES
      ($1,$2,$3,'Homepage concept notes.txt',$4,true),
      ($1,$2,$5,'Internal estimate.txt',$6,false),
      ($1,$7,$8,'Planning notes.txt',$6,true)`,
      [d.north,d.review,d.publicFile,Buffer.from('Homepage concept: a product-led hero and a short customer story.\n'),
        d.privateFile,Buffer.from('Agency working notes.\n'),d.privateTask,d.hiddenParentFile]);
    await run(`INSERT INTO time_entries VALUES
      ($1,$2,$3,$4,120,'Homepage design',CURRENT_DATE,true),
      ($1,$2,$5,$4,30,'Internal prep',CURRENT_DATE,false),
      ($1,$6,$7,$4,60,'Budget review',CURRENT_DATE,true)`,
      [d.north,d.review,key(71),d.member,key(72),d.privateTask,key(73)]);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = await openDatabase();
  try {
    await seed(db);
    console.log('Demo data ready. See README.md for sign-in details.');
  } finally {
    await db.close();
  }
}
