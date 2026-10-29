import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type Row = any;
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * PostgreSQL access. With DATABASE_URL we use node-postgres against a real server; otherwise
 * PGlite (PostgreSQL compiled to WASM) persists to `dataDir` — same SQL, same constraints.
 */
export async function openDb(dataDir: string): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Omit<Db, 'tx' | 'close'> => ({
      query: async (s, p) => (await c.query(s, p as any[])).rows,
      one: async (s, p) => (await c.query(s, p as any[])).rows[0],
      exec: async (s) => { await c.query(s); },
    });
    db = {
      ...wrap(pool),
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const inner: Db = { ...wrap(client), tx: (f) => f(inner), close: async () => {} };
          const r = await fn(inner);
          await client.query('COMMIT');
          return r;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const pgl = await PGlite.create(dataDir);
    const wrap = (c: any): Omit<Db, 'tx' | 'close'> => ({
      query: async (s, p) => (await c.query(s, p)).rows,
      one: async (s, p) => (await c.query(s, p)).rows[0],
      exec: async (s) => { await c.exec(s); },
    });
    let inTx = false;
    db = {
      ...wrap(pgl),
      tx: async (fn) => {
        if (inTx) return fn(db);
        return pgl.transaction(async (t: any) => {
          inTx = true;
          try {
            const inner: Db = { ...wrap(t), tx: (f) => f(inner), close: async () => {} };
            return await fn(inner);
          } finally {
            inTx = false;
          }
        }) as any;
      },
      close: () => pgl.close(),
    };
  }
  await db.exec(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}
