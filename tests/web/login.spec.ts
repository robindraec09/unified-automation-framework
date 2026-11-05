import { test, expect } from '@qa/test';

// Login tests start logged out
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login', () => {
  test('standard user lands on products @smoke', async ({ shop, config }) => {
    await shop.login.loginAs(config.web.user, config.web.password);
    await expect(shop.inventory.title).toHaveText('Products');
  });

  test('locked-out user sees an error @regression', async ({ shop, config }) => {
    await shop.login.loginAs('locked_out_user', config.web.password);
    await expect(shop.login.error).toContainText('locked out');
  });
});
