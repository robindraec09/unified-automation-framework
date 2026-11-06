import { defineConfig } from '@playwright/test';
import { BUILD } from '@qa/core';

/**
 * Used by `playwright merge-reports --config merge.config.ts build/reports/blob` (the CI report job):
 * turns the shards' blob reports into the engineers' HTML report and the stakeholder report.
 */
export default defineConfig({
  testDir: './tests',
  reporter: [
    ['html', { open: 'never', outputFolder: BUILD.playwrightReport }],
    [
      './packages/reporting/src/stakeholder-reporter.ts',
      {
        title: 'Quality report',
        outputFolder: BUILD.stakeholderReport,
        detailReportFolder: BUILD.playwrightReport,
      },
    ],
  ],
});
