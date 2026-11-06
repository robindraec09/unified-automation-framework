import { defineConfig } from '@playwright/test';

/**
 * Used by `playwright merge-reports --config merge.config.ts <blob-dir>` (the CI report job):
 * turns the shards' blob reports into the engineers' HTML report and the stakeholder report.
 */
export default defineConfig({
  testDir: './tests',
  reporter: [
    ['html', { open: 'never' }],
    ['./packages/reporting/src/stakeholder-reporter.ts', { title: 'Quality report' }],
  ],
});
