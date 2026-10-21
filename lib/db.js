// Postgres pool shared by all functions. One small pool per warm instance.
import pg from 'pg';

let pool;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const host = (() => { try { return new URL(connectionString).hostname; } catch { return ''; } })();
  const local = host === 'localhost' || host === '127.0.0.1';
  const ssl = process.env.PGSSL === 'disable' || local ? false : { rejectUnauthorized: false };
  pool = new pg.Pool({ connectionString, ssl, max: 3, idleTimeoutMillis: 10_000 });
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

// Runs fn(client) inside a transaction: everything is applied, or nothing is.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
