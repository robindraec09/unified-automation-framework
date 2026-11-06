import { test, expect } from '@qa/test';
import { toAud } from '@qa/web';
import type { Account } from '@qa/api';

/** Signed in as the seeded customer (storage state from bank-setup). Read-only, so safe in parallel. */
test.describe('Bank accounts', () => {
  test('dashboard shows every account with the balance the API reports @smoke', async ({ bank, bankApi }) => {
    const accounts: Account[] = await (await bankApi.accounts()).json();
    await bank.accounts.open();

    await expect(bank.accounts.cards).toHaveCount(accounts.length);
    for (const a of accounts) await expect(bank.accounts.balanceOf(a.name)).toHaveText(toAud(a.balance));
    const net = accounts.reduce((s, a) => s + Math.round(a.balance * 100), 0) / 100;
    await expect(bank.accounts.netPosition).toHaveText(toAud(net));
  });

  test('opening an account shows its transactions newest first @regression', async ({ bank, bankApi }) => {
    const [account] = (await (await bankApi.accounts()).json()) as Account[];
    const txns = await (await bankApi.transactions(account!.id, { limit: 50 })).json();

    await bank.accounts.open();
    await bank.accounts.openAccount(account!.name);
    await expect(bank.account.name).toHaveText(account!.name);
    await expect(bank.account.balance).toHaveText(toAud(account!.balance));
    await expect(bank.account.rows).toHaveCount(txns.length);
    await expect(bank.account.rows.first()).toContainText(txns[0].description);
  });

  test('unknown account shows a friendly not-found message @negative', async ({ bank }) => {
    await bank.account.openById(999_999);
    await expect(bank.account.error).toHaveText('Account not found');
  });

  test('accounts page has no serious accessibility violations @a11y', async ({ bank, a11y }) => {
    await bank.accounts.open();
    await expect(bank.accounts.cards.first()).toBeVisible();
    const { violations } = await a11y();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, 'serious/critical axe violations').toEqual([]);
  });
});
