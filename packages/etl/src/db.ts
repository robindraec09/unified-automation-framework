import pg from 'pg';

/**
 * Minimal DB interface every platform adapter implements.
 * Add adapters for mssql, oracledb, snowflake-sdk, @google-cloud/bigquery, Databricks SQL as needed.
 */
export interface DbClient {
  readonly name: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class PostgresClient implements DbClient {
  private pool: pg.Pool;

  constructor(
    readonly name: string,
    connectionString: string,
  ) {
    // NUMERIC/BIGINT as JS numbers so aggregates compare cleanly; fine for test-sized values
    pg.types.setTypeParser(1700, (v: string) => Number(v));
    pg.types.setTypeParser(20, (v: string) => Number(v));
    this.pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 3_000 });
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length !== 1) throw new Error(`[${this.name}] expected 1 row, got ${rows.length}: ${sql}`);
    return rows[0] as T;
  }

  async ping() {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function connect(name: string, url: string): DbClient {
  if (url.startsWith('postgres')) return new PostgresClient(name, url);
  throw new Error(`No DB adapter for ${url.split(':')[0]} yet; add one in packages/etl/src/db.ts`);
}
