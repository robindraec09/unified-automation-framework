import { defineConfig, devices } from '@playwright/test';
import { loadConfig, AUTH } from '@qa/core';

const cfg = loadConfig();
const isCI = !!process.env.CI;
const STANDARD_USER = AUTH.standardUser;

/**
 * One runner, many channels. Each channel is a Playwright project:
 *   setup → api, web-*, mobile-web, android, ios, etl
 * Select with --project and filter with --grep @tag.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [['blob'], ['github'], ['allure-playwright']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: cfg.web.baseUrl,
    // The demo app (saucedemo) uses data-test. Change to your team's test-id contract.
    testIdAttribute: 'data-test',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Auth / storage state, runs first for web projects
    { name: 'setup', testMatch: /setup\/.*\.setup\.ts/ },

    // API
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: cfg.api.baseUrl },
    },

    // Web (logged-in storage state produced by the setup project)
    {
      name: 'web-chromium',
      testDir: './tests/web',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STANDARD_USER },
    },
    {
      name: 'web-firefox',
      testDir: './tests/web',
      dependencies: ['setup'],
      use: { ...devices['Desktop Firefox'], storageState: STANDARD_USER },
    },
    {
      name: 'web-webkit',
      testDir: './tests/web',
      dependencies: ['setup'],
      use: { ...devices['Desktop Safari'], storageState: STANDARD_USER },
    },
    {
      name: 'mobile-web',
      testDir: './tests/web',
      grep: /@smoke/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: STANDARD_USER },
    },

    // Native mobile via Appium (one device per worker)
    { name: 'android', testDir: './tests/mobile', workers: cfg.mobile.maxDevices },
    { name: 'ios', testDir: './tests/mobile', workers: cfg.mobile.maxDevices },

    // ETL / data
    { name: 'etl', testDir: './tests/etl', fullyParallel: false, timeout: 15 * 60_000 },
  ],
});
