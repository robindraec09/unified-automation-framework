import { test, expect } from '@qa/test';
import { mobileLogin } from '@qa/flows';

// Needs a running Appium server (or device cloud) and an app build; see README "Mobile".
test.skip(!process.env.MOBILE_ENABLED, 'Set MOBILE_ENABLED=1 with Appium running to execute mobile tests');

test.describe('Mobile login', () => {
  test('valid user reaches home @smoke @device', async ({ app, config }) => {
    await mobileLogin(app.login).loginAs(config.web.user, config.web.password);
    expect(await app.login.isHomeVisible()).toBe(true);
  });
});
