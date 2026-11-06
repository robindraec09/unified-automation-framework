import { test, expect } from '@qa/test';

// Login tests start logged out
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Bank login', () => {
  test('customer logs in and lands on accounts @smoke', async ({ bank, config }) => {
    await bank.login.loginAs(config.bank.user, config.bank.password);
    await expect(bank.accounts.heading).toBeVisible();
    await expect(bank.accounts.nav.customerName).toHaveText('Alex Morgan');
  });

  test('wrong password shows an error and stays on login @negative', async ({ bank, bankCustomer, page }) => {
    await bank.login.loginAs(bankCustomer.username, 'wrong-password');
    await expect(bank.login.error).toHaveText('Username or password is incorrect');
    await expect(page).toHaveURL(/\/login/);
  });

  test('locked customer is told to contact support @negative', async ({ bank }) => {
    await bank.login.loginAs('sam.locked', 'Harbour#2026');
    await expect(bank.login.error).toContainText('locked');
  });

  test('empty form is validated before submitting @negative', async ({ bank }) => {
    await bank.login.open();
    await bank.login.submit.click();
    await expect(bank.login.error).toHaveText('Enter your customer ID and password');
  });

  test('deep link redirects to login, then back to the page asked for @regression', async ({
    bank,
    config,
    page,
  }) => {
    await page.goto('/payees');
    await expect(page).toHaveURL(/\/login\?next=%2Fpayees/);
    await bank.login.username.fill(config.bank.user);
    await bank.login.password.fill(config.bank.password);
    await bank.login.submit.click();
    await expect(page).toHaveURL(/\/payees$/);
  });

  test('logging out ends the session @security', async ({ bank, config, page }) => {
    await bank.login.loginAs(config.bank.user, config.bank.password);
    await expect(bank.accounts.heading).toBeVisible();
    await bank.accounts.nav.logout();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/accounts');
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});
