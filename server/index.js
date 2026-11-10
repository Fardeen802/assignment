import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db.js';

const db = await openDatabase();
const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === '1' });
app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || '127.0.0.1',
  () => console.log('AgencyDesk listening on port ' + port));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.close(async () => { await db.close(); process.exit(); }));
}
