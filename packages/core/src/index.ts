export { loadConfig, type FrameworkConfig } from './config';
export { logger } from './logger';

/**
 * Everything a test run generates lives under build/ (one folder to clean, cache or upload).
 * Paths are relative to the repo root, where Playwright runs.
 */
export const BUILD = {
  root: 'build',
  reports: 'build/reports',
  /** Engineers' Playwright HTML report */
  playwrightReport: 'build/reports/playwright',
  /** One-page stakeholder report, its summaries and trend history */
  stakeholderReport: 'build/reports/stakeholder',
  /** Raw Allure results (CI) */
  allureResults: 'build/reports/allure-results',
  /** Blob reports from CI shards, merged by the report job */
  blobReport: 'build/reports/blob',
  /** JSON from the qa-framework MCP server's run_tests tool */
  mcpReport: 'build/reports/mcp',
  /** Playwright outputDir: screenshots, videos, traces, attachments (wiped at the start of each run) */
  testResults: 'build/test-results',
  /** Saved login sessions written by the setup projects */
  auth: 'build/auth',
} as const;

/** Storage-state files written by the setup project, one per role. */
export const AUTH = {
  standardUser: `${BUILD.auth}/standard-user.json`,
  bankCustomer: `${BUILD.auth}/bank-customer.json`,
} as const;
