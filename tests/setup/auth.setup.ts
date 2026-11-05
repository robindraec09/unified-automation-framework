import { test as setup, expect } from '@qa/test';
import { AUTH } from '@qa/core';

/** Logs in once per run and saves storage state for the web projects. */
// Carries every web tag so `--grep @tag` runs never filter out the setup that web tests depend on
setup('authenticate standard user @smoke @regression @a11y', async ({ shop, config, page }) => {
  await shop.login.loginAs(config.web.user, config.web.password);
  await expect(shop.inventory.title).toHaveText('Products');
  await page.context().storageState({ path: AUTH.standardUser });
});
