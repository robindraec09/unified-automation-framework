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
      // Decided per rule at collection time, so the test body has no branches
      const dbName = file.database === 'source' ? 'source' : 'warehouse';
      const isWarn = rule.severity === 'warn';
      const label = isWarn ? 'violations (warn)' : 'violations';
      const sql = ruleSql(file.table, rule);
      // warn-severity rules fail softly: reported, but the run continues
      const expectRule = expect.configure({ soft: isWarn });

      test(`${ruleTitle(rule)} ${tags}`, async ({ source, warehouse }) => {
        const db = { source, warehouse }[dbName];
        const { violations } = await db.one<{ violations: number }>(sql);
        test.info().annotations.push({ type: 'sql', description: sql });

        expectRule(violations, label).toBe(0);
      });
    }
  });
}
