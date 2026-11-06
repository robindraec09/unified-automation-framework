import { test, expect } from '@qa/test';
import { PayeeBuilder } from '@qa/data';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Bank payees', () => {
  test.beforeEach(async ({ bank, bankCustomer }) => {
    await bank.login.loginAs(bankCustomer.username, bankCustomer.password);
    await expect(bank.accounts.heading).toBeVisible();
    await bank.payees.open();
  });

  test('add a payee, then delete it @regression', async ({ bank }) => {
    const payee = PayeeBuilder.default().withNickname('Flatmate').build();
    await bank.payees.add(payee);
    await expect(bank.payees.success).toHaveText(`${payee.name} added`);
    await expect(bank.payees.row(payee.name)).toContainText(payee.bsb);
    await expect(bank.payees.row(payee.name)).toContainText('Flatmate');

    await bank.payees.remove(payee.name);
    await expect(bank.payees.success).toHaveText(`${payee.name} deleted`);
    await expect(bank.payees.row(payee.name)).toHaveCount(0);
  });

  test('invalid BSB shows the server validation message @negative', async ({ bank }) => {
    await bank.payees.add(PayeeBuilder.default().withBsb('12-3456').build());
    await expect(bank.payees.error).toContainText('BSB must look like 123-456');
    await expect(bank.payees.rows).toHaveCount(0);
  });
});
