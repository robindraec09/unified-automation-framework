import { test, expect } from '@qa/test';
import { loadRuleFiles, ruleSql, ruleTitle } from '@qa/etl';

/**
 * Data-quality tests generated from config/etl/rules/*.yml.
 * One test per rule, so the report shows failures by table and rule.
 */
for (const file of loadRuleFiles()) {
  test.describe(`DQ ${file.table} (${file.file})`, () => {
    for (const rule of file.rules) {
      const tags = ['@etl', ...file.tags].join(' ');
      test(`${ruleTitle(rule)} ${tags}`, async ({ source, warehouse }) => {
        const db = file.database === 'source' ? source : warehouse;
        const sql = ruleSql(file.table, rule);
        const { violations } = await db.one<{ violations: number }>(sql);
        test.info().annotations.push({ type: 'sql', description: sql });

        if (rule.severity === 'warn') expect.soft(violations, 'violations (warn)').toBe(0);
        else expect(violations, 'violations').toBe(0);
      });
    }
  });
}
