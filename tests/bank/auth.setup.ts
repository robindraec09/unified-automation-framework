import { test as setup, expect } from '@qa/test';
import { AUTH } from '@qa/core';

/** Logs in to Harbourline once per run and saves the session cookie for the bank-web project. */
// Carries every bank-web tag so `--grep @tag` runs keep the setup they depend on
setup('authenticate bank customer @smoke @regression @a11y @security @db', async ({ bank, config, page }) => {
  await bank.login.loginAs(config.bank.user, config.bank.password);
  await expect(bank.accounts.heading).toBeVisible();
  await page.context().storageState({ path: AUTH.bankCustomer });
});
