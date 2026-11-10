import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export async function openDatabase(url = process.env.DATABASE_URL, directory = './data') {
  let db;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    db = {
      transaction: async (work) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    db = new PGlite(directory);
  }

  const migration = await readFile(new URL('../db/001.sql', import.meta.url), 'utf8');
  await db.transaction(async (tx) => {
    if (url) await tx.query('SELECT pg_advisory_xact_lock(243885)');
    await tx.query('CREATE TABLE IF NOT EXISTS migrations (version integer PRIMARY KEY)');
    if (!(await tx.query('SELECT version FROM migrations WHERE version = 1')).rows.length) {
      if (url) await tx.query(migration);
      else await tx.exec(migration);
      await tx.query('INSERT INTO migrations VALUES (1)');
    }
  });
  return db;
}
