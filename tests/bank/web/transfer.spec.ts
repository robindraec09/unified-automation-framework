import { test, expect } from '@qa/test';
import { toAud } from '@qa/web';
import { PayeeBuilder } from '@qa/data';

// Each test signs in as its own fresh customer (Everyday $1,000, Saver $5,000)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Bank transfer & pay', () => {
  test.beforeEach(async ({ bank, bankCustomer }) => {
    await bank.login.loginAs(bankCustomer.username, bankCustomer.password);
    await expect(bank.accounts.heading).toBeVisible();
  });

  test('transfer between own accounts shows a receipt and moves the money @smoke @db', async ({
    bank,
    bankDb,
  }) => {
    await bank.transfer.open();
    await bank.transfer.transferBetween('Everyday Account', 'Saver Account', '125.50', 'Holiday fund');

    await expect(bank.transfer.receipt).toBeVisible();
    await expect(bank.transfer.receiptSummary).toHaveText(`${toAud(125.5)} sent to Saver Account`);
    const receiptId = await bank.transfer.receiptId.textContent();

    // The receipt number is the transfer row written to the database
    const row = await bankDb.one<{ amount_cents: number; description: string }>(
      'select amount_cents, description from bank.transfers where id = $1',
      [receiptId],
    );
    expect(row).toEqual({ amount_cents: 12550, description: 'Holiday fund' });

    await bank.accounts.open();
    await expect(bank.accounts.balanceOf('Everyday Account')).toHaveText(toAud(874.5));
    await expect(bank.accounts.balanceOf('Saver Account')).toHaveText(toAud(5125.5));
  });

  test('insufficient funds shows an error and changes nothing @negative', async ({ bank }) => {
    await bank.transfer.open();
    await bank.transfer.transferBetween('Everyday Account', 'Saver Account', '1000.01');
    await expect(bank.transfer.error).toHaveText('Insufficient available funds in the from account');
    await expect(bank.transfer.receipt).toBeHidden();

    await bank.accounts.open();
    await expect(bank.accounts.balanceOf('Everyday Account')).toHaveText(toAud(1000));
  });

  for (const amount of ['0', 'abc', '10.999', '-5']) {
    test(`amount "${amount}" is rejected before submitting @negative`, async ({ bank }) => {
      await bank.transfer.open();
      await bank.transfer.transferBetween('Everyday Account', 'Saver Account', amount);
      await expect(bank.transfer.error).toContainText('Enter an amount greater than $0.00');
    });
  }

  test('pay a payee arranged through the API @regression', async ({ bank, bankApiAs, bankCustomer }) => {
    const api = await bankApiAs({ basic: { user: bankCustomer.username, password: bankCustomer.password } });
    const payee = PayeeBuilder.default().build();
    expect((await api.addPayee(payee)).status()).toBe(201);

    await bank.transfer.open();
    await bank.transfer.payPayee('Saver Account', payee.name, '75', 'Dinner');
    await expect(bank.transfer.receiptSummary).toHaveText(`${toAud(75)} sent to ${payee.name}`);

    await bank.accounts.open();
    await expect(bank.accounts.balanceOf('Saver Account')).toHaveText(toAud(4925));
    await expect(bank.accounts.balanceOf('Everyday Account')).toHaveText(toAud(1000));
  });
});
