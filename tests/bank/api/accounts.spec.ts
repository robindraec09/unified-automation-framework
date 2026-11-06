import { test, expect } from '@qa/test';
import { AccountListSchema, AccountSchema, TransactionListSchema } from '@qa/api';

test.describe('Bank accounts API', () => {
  test('lists the customer accounts matching the contract @smoke @contract', async ({ bankApi }) => {
    const res = await bankApi.accounts();
    expect(res.status()).toBe(200);
    await expect(res).toMatchSchema(AccountListSchema);
    const accounts = await res.json();
    expect(accounts.map((a: { type: string }) => a.type)).toEqual(['transaction', 'savings', 'credit']);
  });

  test('credit card available balance includes the credit limit @functional', async ({ bankApi }) => {
    const accounts = await (await bankApi.accounts()).json();
    const card = accounts.find((a: { type: string }) => a.type === 'credit');
    expect(card.balance).toBeLessThan(0);
    expect(card.availableBalance).toBeGreaterThan(card.balance);
  });

  test('single account matches the contract @contract', async ({ bankApi }) => {
    const [first] = await (await bankApi.accounts()).json();
    const res = await bankApi.account(first.id);
    expect(res.status()).toBe(200);
    await expect(res).toMatchSchema(AccountSchema);
  });

  test("another customer's account is not found, not forbidden @security", async ({
    bankApi,
    bankCustomer,
  }) => {
    // 404 (not 403) so account ids cannot be probed
    const res = await bankApi.account(bankCustomer.accounts[0]!.id);
    expect(res.status()).toBe(404);
  });

  test('transactions are newest first and the running balance is consistent @contract @functional', async ({
    bankApi,
  }) => {
    const [account] = await (await bankApi.accounts()).json();
    const res = await bankApi.transactions(account.id, { limit: 200 });
    expect(res.status()).toBe(200);
    await expect(res).toMatchSchema(TransactionListSchema);
    const txns: { postedAt: string; amount: number; balanceAfter: number }[] = await res.json();

    const times = txns.map((t) => Date.parse(t.postedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // Each row's balance = the older row's balance + this row's amount (in cents, to avoid float drift)
    const cents = (n: number) => Math.round(n * 100);
    const breaks = txns
      .slice(0, -1)
      .filter((t, i) => cents(txns[i + 1]!.balanceAfter) + cents(t.amount) !== cents(t.balanceAfter));
    expect(breaks).toEqual([]);
    expect(txns[0]!.balanceAfter).toBe(account.balance);
  });

  test('transactions limit and bad query parameters @negative', async ({ bankApi }) => {
    const [account] = await (await bankApi.accounts()).json();
    expect(await (await bankApi.transactions(account.id, { limit: 3 })).json()).toHaveLength(3);
    expect((await bankApi.transactions(account.id, { limit: 0 })).status()).toBe(400);
    expect((await bankApi.transactions(account.id, { from: 'not-a-date' })).status()).toBe(400);
  });
});
