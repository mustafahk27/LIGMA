import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err: Error) => {
  console.error('Unexpected Postgres pool error:', err);
});

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  console.log('query', { text, duration, rows: result.rowCount });
  return result;
}
