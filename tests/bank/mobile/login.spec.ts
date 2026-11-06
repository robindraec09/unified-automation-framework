import { test, expect } from '@qa/test';
import { toAud } from '@qa/web';

/** Harbourline Mobile (native Android) sign-in, on the emulator in Docker. */
test.describe('Bank mobile sign-in', () => {
  test('customer signs in and sees their accounts @smoke @device', async ({ bankApp, bankCustomer }) => {
    await bankApp.login.loginAs(bankCustomer.username, bankCustomer.password);

    expect(await bankApp.accounts.customer()).toBe('QA Test Customer');
    expect(await bankApp.accounts.balanceOf('Everyday Account')).toBe(toAud(1000));
    expect(await bankApp.accounts.balanceOf('Saver Account')).toBe(toAud(5000));
  });

  test('wrong password shows an error @negative @device', async ({ bankApp, bankCustomer }) => {
    await bankApp.login.loginAs(bankCustomer.username, 'wrong-password');
    expect(await bankApp.login.errorText()).toBe('Customer ID or password is incorrect');
  });

  test('locked customer is told to contact support @negative @security @device', async ({ bankApp }) => {
    await bankApp.login.loginAs('sam.locked', 'Harbour#2026');
    expect(await bankApp.login.errorText()).toContain('locked');
  });

  test('empty form is validated before calling the bank @negative @device', async ({ bankApp }) => {
    await bankApp.login.waitUntilShown();
    await bankApp.login.loginAs('', '');
    expect(await bankApp.login.errorText()).toBe('Enter your customer ID and password');
  });

  test('logging out returns to sign-in @security @device', async ({ bankApp, bankCustomer }) => {
    await bankApp.login.loginAs(bankCustomer.username, bankCustomer.password);
    await bankApp.accounts.waitUntilShown();
    await bankApp.accounts.logout();
    expect(await bankApp.login.isShown()).toBe(true);
  });
});
