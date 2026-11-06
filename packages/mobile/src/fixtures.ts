import { test as base, type TestInfo } from '@playwright/test';
import { remote } from 'webdriverio';
import { logger } from '@qa/core';
import { appiumIsUp, connectionOptions, loadCapabilities } from './capabilities';
import { LoginScreen } from './screens/login.screen';
import { BankLoginScreen } from './screens/bank/bank-login.screen';
import { AccountsScreen } from './screens/bank/accounts.screen';
import { TransferScreen } from './screens/bank/transfer.screen';
import { HARBOURLINE_PACKAGE } from './screens/bank/ids';

const log = logger('mobile');

export type MobileWorkerFixtures = {
  /** Device config name (config/devices/<name>.json) for this project; DEVICE env var overrides it. */
  mobileDevice: string | undefined;
  /** Opens the worker's Appium session on first call and reuses it; closed when the worker ends. */
  mobileSession: () => Promise<WebdriverIO.Browser>;
  /** Eager session, for specs that always need a device (tests/mobile). */
  driver: WebdriverIO.Browser;
};

export type MobileFixtures = {
  app: { login: LoginScreen };
  /** Harbourline Mobile screens on a freshly restarted app (signed out). */
  bankApp: { login: BankLoginScreen; accounts: AccountsScreen; transfer: TransferScreen };
};

const APPIUM_DOWN =
  'Appium / Android emulator not reachable: start it with `pnpm mobile:up` (see README "Mobile")';

/**
 * Clears Android's "<app> isn't responding" dialog if one is up: on a busy emulator System UI can stall
 * at boot, and the dialog then sits over the app under test. Taps "Wait" (android:id/aerr_wait).
 */
async function dismissSystemDialogs(driver: WebdriverIO.Browser) {
  for (let i = 0; i < 3; i++) {
    const wait = driver.$('android=new UiSelector().resourceId("android:id/aerr_wait")');
    if (!(await wait.isExisting().catch(() => false))) return;
    log.warn('dismissing an Android "not responding" dialog');
    await wait.click().catch(() => undefined);
  }
}

/** Screenshot + screen source attached to the Playwright report when a test fails. */
async function attachEvidence(driver: WebdriverIO.Browser, testInfo: TestInfo) {
  if (testInfo.status === testInfo.expectedStatus) return;
  const png = await driver.takeScreenshot().catch(() => undefined);
  if (png)
    await testInfo.attach('screenshot', { body: Buffer.from(png, 'base64'), contentType: 'image/png' });
  const source = await driver.getPageSource().catch(() => undefined);
  if (source) await testInfo.attach('page-source.xml', { body: source, contentType: 'application/xml' });
}

/**
 * Appium runs inside Playwright Test: Playwright owns lifecycle, retries, reporting;
 * a worker-scoped WebdriverIO session gives each worker one device.
 */
export const mobileTest = base.extend<MobileFixtures, MobileWorkerFixtures>({
  mobileDevice: [undefined, { option: true, scope: 'worker' }],

  mobileSession: [
    async ({ mobileDevice }, use, workerInfo) => {
      let session: Promise<WebdriverIO.Browser> | undefined;
      await use(() => {
        session ??= (async () => {
          const capabilities = loadCapabilities(workerInfo.project.name, mobileDevice);
          log.info('starting Appium session', { project: workerInfo.project.name, capabilities });
          return remote({
            ...connectionOptions(),
            capabilities,
            logLevel: 'warn',
            connectionRetryTimeout: 300_000,
          });
        })();
        return session;
      });
      if (session) await (await session).deleteSession().catch(() => undefined);
    },
    { scope: 'worker' },
  ],

  driver: [async ({ mobileSession }, use) => use(await mobileSession()), { scope: 'worker' }],

  app: async ({ driver }, use, testInfo) => {
    await use({ login: new LoginScreen(driver) });
    await attachEvidence(driver, testInfo);
  },

  bankApp: async ({ mobileSession }, use, testInfo) => {
    // Skip (or fail, with MOBILE_REQUIRED=1 as in CI and the Docker runner) before any session is opened
    const up = await appiumIsUp();
    if (!up && process.env.MOBILE_REQUIRED === '1') throw new Error(APPIUM_DOWN);
    testInfo.skip(!up, APPIUM_DOWN);

    const driver = await mobileSession();
    // A cold start per test: the app keeps its session in memory, so this always lands on sign-in
    await dismissSystemDialogs(driver);
    await driver.terminateApp(HARBOURLINE_PACKAGE).catch(() => undefined);
    await driver.activateApp(HARBOURLINE_PACKAGE);
    await dismissSystemDialogs(driver);
    await use({
      login: new BankLoginScreen(driver),
      accounts: new AccountsScreen(driver),
      transfer: new TransferScreen(driver),
    });
    await attachEvidence(driver, testInfo);
  },
});
