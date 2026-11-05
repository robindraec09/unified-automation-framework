import type { DbClient } from './db';

export interface HashDiffOptions {
  /** SQL returning (key, hash) pairs from the source, already transformed to target shape */
  sourceSql: string;
  /** SQL returning (key, hash) pairs from the target */
  targetSql: string;
  params?: unknown[];
  maxRows?: number;
}

export interface RowDiff {
  key: string;
  issue: 'missing_in_target' | 'unexpected_in_target' | 'value_mismatch';
}

/**
 * Row-level reconciliation by key + hash of business columns.
 * Hashing happens in SQL (push-down); only (key, hash) pairs travel.
 * For very large tables, bucket by hash prefix or partition first and drill into mismatching buckets only.
 */
export async function diffByHash(source: DbClient, target: DbClient, o: HashDiffOptions): Promise<RowDiff[]> {
  const [s, t] = await Promise.all([
    source.query<{ key: string; hash: string }>(o.sourceSql, o.params),
    target.query<{ key: string; hash: string }>(o.targetSql, o.params),
  ]);
  const sm = new Map(s.map((r) => [String(r.key), r.hash]));
  const tm = new Map(t.map((r) => [String(r.key), r.hash]));
  const diffs: RowDiff[] = [];

  for (const [k, h] of sm) {
    if (!tm.has(k)) diffs.push({ key: k, issue: 'missing_in_target' });
    else if (tm.get(k) !== h) diffs.push({ key: k, issue: 'value_mismatch' });
  }
  for (const k of tm.keys()) if (!sm.has(k)) diffs.push({ key: k, issue: 'unexpected_in_target' });

  return diffs.slice(0, o.maxRows ?? 100);
}

export function toCsv(rows: object[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0] as object);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c])).join(','))].join(
    '\n',
  );
}
