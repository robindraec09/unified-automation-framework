import pg from 'pg';
import { settings } from './config';

// BIGINT (cents) as JS numbers: safe up to 2^53, far beyond any test balance
pg.types.setTypeParser(20, (v: string) => Number(v));

export const pool = new pg.Pool({
  connectionString: settings.dbUrl,
  max: 10,
  connectionTimeoutMillis: 3_000,
  options: '-c search_path=bank',
});

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}

export async function maybeOne<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

/** Run `fn` in one transaction; rolls back on any error. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
