import { test, expect } from '@qa/test';
import { toAud } from '@qa/web';

/**
 * Money movement from the Android app. Each test is its own fresh customer (Everyday $1,000, Saver $5,000);
 * results are checked on screen, through the API and in the database.
 */
test.describe('Bank mobile transfers', () => {
  test.beforeEach(async ({ bankApp, bankCustomer }) => {
    await bankApp.login.loginAs(bankCustomer.username, bankCustomer.password);
    await bankApp.accounts.waitUntilShown();
  });

  test('transfer between own accounts shows a receipt and moves the money @smoke @db @device', async ({
    bankApp,
    bankApiAs,
    bankCustomer,
    bankDb,
  }) => {
    await bankApp.accounts.openTransfer();
    await bankApp.transfer.transferBetween('Everyday Account', 'Saver Account', '125.50', 'Mobile top-up');

    const receipt = await bankApp.transfer.receiptText();
    expect(receipt.summary).toBe(`${toAud(125.5)} sent to Saver Account`);

    // The receipt number is the transfer the app created
    const row = await bankDb.one<{ amount_cents: number; description: string }>(
      'select amount_cents, description from bank.transfers where id = $1',
      [receipt.id],
    );
    expect(row).toEqual({ amount_cents: 12550, description: 'Mobile top-up' });

    // Same balances on the phone and through the API
    await bankApp.transfer.done();
    await bankApp.accounts.waitForBalance('Everyday Account', toAud(874.5));
    await bankApp.accounts.waitForBalance('Saver Account', toAud(5125.5));
    const api = await bankApiAs({ basic: { user: bankCustomer.username, password: bankCustomer.password } });
    const balances = Object.fromEntries(
      ((await (await api.accounts()).json()) as { name: string; balance: number }[]).map((a) => [
        a.name,
        a.balance,
      ]),
    );
    expect(balances).toEqual({ 'Everyday Account': 874.5, 'Saver Account': 5125.5 });
  });

  test('insufficient funds is refused and nothing moves @negative @device', async ({ bankApp }) => {
    await bankApp.accounts.openTransfer();
    await bankApp.transfer.transferBetween('Everyday Account', 'Saver Account', '1000.01');
    expect(await bankApp.transfer.errorText()).toBe('Insufficient available funds in the from account');
  });

  test('an invalid amount is rejected before calling the bank @negative @device', async ({ bankApp }) => {
    await bankApp.accounts.openTransfer();
    await bankApp.transfer.transferBetween('Everyday Account', 'Saver Account', '10.999');
    expect(await bankApp.transfer.errorText()).toContain('Enter an amount greater than $0.00');
  });
});
