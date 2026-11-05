import { test, expect } from '@qa/test';

/**
 * Seed test: the entry point Playwright's planner agent uses to explore the app.
 * It shows the agent our conventions: import from '@qa/test', use page objects, tag every test.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('seed: logged-in shopper on products page', async ({ shop, config }) => {
  await shop.login.loginAs(config.web.user, config.web.password);
  await expect(shop.inventory.title).toHaveText('Products');
});
