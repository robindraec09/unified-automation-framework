import { test as base } from '@playwright/test';
import { remote } from 'webdriverio';
import { logger } from '@qa/core';
import { loadCapabilities, connectionOptions } from './capabilities';
import { LoginScreen } from './screens/login.screen';

const log = logger('mobile');

export type MobileWorkerFixtures = { driver: WebdriverIO.Browser };
export type MobileFixtures = { app: { login: LoginScreen } };

/**
 * Appium runs inside Playwright Test: Playwright owns lifecycle, retries, reporting;
 * a worker-scoped WebdriverIO session gives each worker one device.
 */
export const mobileTest = base.extend<MobileFixtures, MobileWorkerFixtures>({
  driver: [
    async ({}, use, workerInfo) => {
      const capabilities = loadCapabilities(workerInfo.project.name);
      log.info('starting Appium session', { project: workerInfo.project.name, capabilities });
      const driver = await remote({ ...connectionOptions(), capabilities, logLevel: 'warn' });
      await use(driver);
      await driver.deleteSession();
    },
    { scope: 'worker' },
  ],

  app: async ({ driver }, use, testInfo) => {
    await use({ login: new LoginScreen(driver) });

    // Evidence on failure: screenshot + page source, attached to the Playwright report
    if (testInfo.status !== testInfo.expectedStatus) {
      const png = await driver.takeScreenshot().catch(() => undefined);
      if (png) await testInfo.attach('screenshot', { body: Buffer.from(png, 'base64'), contentType: 'image/png' });
      const source = await driver.getPageSource().catch(() => undefined);
      if (source) await testInfo.attach('page-source.xml', { body: source, contentType: 'application/xml' });
    }
  },
});
