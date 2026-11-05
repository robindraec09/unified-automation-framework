import { readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * Rules as data. Each rule compiles to SQL that returns the number of violating rows
 * (as `violations`); the generated test expects 0.
 */
const Rule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('not_null'), column: z.string() }),
  z.object({ type: z.literal('unique'), columns: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('accepted_values'), column: z.string(), values: z.array(z.string()) }),
  z.object({ type: z.literal('range'), column: z.string(), min: z.number().optional(), max: z.number().optional() }),
  z.object({
    type: z.literal('referential'),
    column: z.string(),
    references: z.object({ table: z.string(), column: z.string() }),
  }),
  z.object({ type: z.literal('freshness'), column: z.string(), maxAgeHours: z.number() }),
  z.object({ type: z.literal('custom_sql'), name: z.string(), sql: z.string() }),
]);

const RuleFile = z.object({
  table: z.string(),
  database: z.enum(['source', 'warehouse']).default('warehouse'),
  owner: z.string().optional(),
  tags: z.array(z.string()).default([]),
  rules: z.array(Rule.and(z.object({ severity: z.enum(['error', 'warn']).default('error') }))),
});

export type EtlRule = z.infer<typeof Rule> & { severity: 'error' | 'warn' };
export type EtlRuleFile = z.infer<typeof RuleFile> & { file: string };

export function loadRuleFiles(dir = resolve(process.cwd(), 'config', 'etl', 'rules')): EtlRuleFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ ...RuleFile.parse(parse(readFileSync(resolve(dir, f), 'utf8'))), file: basename(f) }));
}

export function ruleTitle(r: EtlRule): string {
  switch (r.type) {
    case 'not_null':
      return `${r.column} is not null`;
    case 'unique':
      return `(${r.columns.join(', ')}) is unique`;
    case 'accepted_values':
      return `${r.column} in [${r.values.join(', ')}]`;
    case 'range':
      return `${r.column} within [${r.min ?? '-inf'}, ${r.max ?? 'inf'}]`;
    case 'referential':
      return `${r.column} references ${r.references.table}.${r.references.column}`;
    case 'freshness':
      return `${r.column} newer than ${r.maxAgeHours}h`;
    case 'custom_sql':
      return r.name;
  }
}

export function ruleSql(table: string, r: EtlRule): string {
  const q = (s: string) => s.replace(/'/g, "''");
  switch (r.type) {
    case 'not_null':
      return `select count(*) violations from ${table} where ${r.column} is null`;
    case 'unique':
      return `select count(*) violations from (select ${r.columns.join(',')} from ${table}
              group by ${r.columns.join(',')} having count(*) > 1) d`;
    case 'accepted_values':
      return `select count(*) violations from ${table}
              where ${r.column} not in (${r.values.map((v) => `'${q(v)}'`).join(',')})`;
    case 'range': {
      const c = [r.min !== undefined ? `${r.column} < ${r.min}` : '', r.max !== undefined ? `${r.column} > ${r.max}` : '']
        .filter(Boolean)
        .join(' or ');
      return `select count(*) violations from ${table} where ${c || 'false'}`;
    }
    case 'referential':
      return `select count(*) violations from ${table} t
              left join ${r.references.table} p on t.${r.column} = p.${r.references.column}
              where t.${r.column} is not null and p.${r.references.column} is null`;
    case 'freshness':
      return `select case when max(${r.column}) < now() - interval '${r.maxAgeHours} hours' then 1 else 0 end violations
              from ${table}`;
    case 'custom_sql':
      return `select count(*) violations from (${r.sql}) v`;
  }
}
