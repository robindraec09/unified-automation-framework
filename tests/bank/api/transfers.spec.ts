import { randomUUID } from 'node:crypto';
import { test, expect } from '@qa/test';
import { TransferSchema, type BankClient, type TestCustomer } from '@qa/api';
import { PayeeBuilder } from '@qa/data';

/**
 * Money movement. Every test runs as its own fresh customer (Everyday $1,000, Saver $5,000),
 * so balances are known and tests can run in parallel. The ledger is checked in the database.
 */
test.describe('Bank transfers API', () => {
  let api: BankClient;
  let everyday: TestCustomer['accounts'][number];
  let saver: TestCustomer['accounts'][number];

  test.beforeEach(async ({ bankApiAs, bankCustomer }) => {
    api = await bankApiAs({ oauth: { user: bankCustomer.username, password: bankCustomer.password } });
    [everyday, saver] = bankCustomer.accounts as [typeof everyday, typeof saver];
  });

  const balance = async (id: number) => (await (await api.account(id)).json()).balance as number;

  test('transfer between own accounts moves the money @smoke @functional', async () => {
    const res = await api.transfer({
      fromAccountId: everyday.id,
      toAccountId: saver.id,
      amount: 250.75,
      description: 'Rent saver',
    });
    expect(res.status()).toBe(201);
    await expect(res).toMatchSchema(TransferSchema);
    expect(res.headers()['location']).toMatch(/\/api\/v1\/transfers\/[0-9a-f-]{36}$/);

    expect(await balance(everyday.id)).toBe(749.25);
    expect(await balance(saver.id)).toBe(5250.75);
  });

  test('ledger is double-entry and balances equal the sum of transactions @db', async ({
    bankDb,
    bankCustomer,
  }) => {
    const transfer = await (
      await api.transfer({ fromAccountId: everyday.id, toAccountId: saver.id, amount: 100 })
    ).json();

    const legs = await bankDb.query<{ account_id: number; amount_cents: number }>(
      'select account_id, amount_cents from bank.transactions where transfer_id = $1 order by amount_cents',
      [transfer.id],
    );
    expect(legs).toEqual([
      { account_id: everyday.id, amount_cents: -10000 },
      { account_id: saver.id, amount_cents: 10000 },
    ]);

    const drift = await bankDb.query(
      `select a.id, a.balance_cents, sum(t.amount_cents) ledger
         from bank.accounts a join bank.transactions t on t.account_id = a.id
        where a.customer_id = $1 group by a.id having a.balance_cents <> sum(t.amount_cents)`,
      [bankCustomer.customerId],
    );
    expect(drift, 'accounts whose balance differs from their ledger').toEqual([]);
  });

  test('insufficient funds is refused and nothing changes @negative @db', async ({ bankDb }) => {
    const res = await api.transfer({ fromAccountId: everyday.id, toAccountId: saver.id, amount: 1000.01 });
    expect(res.status()).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'insufficient_funds' });
    expect(await balance(everyday.id)).toBe(1000);
    const { count } = await bankDb.one<{ count: number }>(
      'select count(*)::int count from bank.transfers where from_account_id = $1',
      [everyday.id],
    );
    expect(count).toBe(0);
  });

  test('the whole balance can be transferred (boundary) @functional', async () => {
    expect(
      (await api.transfer({ fromAccountId: everyday.id, toAccountId: saver.id, amount: 1000 })).status(),
    ).toBe(201);
    expect(await balance(everyday.id)).toBe(0);
  });

  for (const [label, amount] of [
    ['zero', 0],
    ['negative', -5],
    ['three decimals', 10.005],
  ] as const) {
    test(`invalid amount (${label}) returns 400 validation_error @negative`, async () => {
      const res = await api.transfer({ fromAccountId: everyday.id, toAccountId: saver.id, amount });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation_error' });
    });
  }

  test('transfer to the same account is rejected @negative', async () => {
    const res = await api.transfer({ fromAccountId: everyday.id, toAccountId: everyday.id, amount: 1 });
    expect(res.status()).toBe(400);
  });

  test("cannot move money from another customer's account @security", async ({ bankApi }) => {
    // bankApi is the seeded customer; everyday belongs to the fresh test customer
    const [own] = await (await bankApi.accounts()).json();
    const res = await bankApi.transfer({ fromAccountId: everyday.id, toAccountId: own.id, amount: 1 });
    expect(res.status()).toBe(404);
    expect(await balance(everyday.id)).toBe(1000);
  });

  test('same Idempotency-Key twice debits once and replays the first result @functional', async () => {
    const key = randomUUID();
    const body = { fromAccountId: everyday.id, toAccountId: saver.id, amount: 40 };
    const first = await api.transfer(body, key);
    const second = await api.transfer(body, key);

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(200);
    expect(second.headers()['idempotent-replayed']).toBe('true');
    expect((await second.json()).id).toBe((await first.json()).id);
    expect(await balance(everyday.id)).toBe(960);
  });

  test('concurrent requests with one Idempotency-Key still debit once @functional', async () => {
    const key = randomUUID();
    const body = { fromAccountId: everyday.id, toAccountId: saver.id, amount: 15 };
    const responses = await Promise.all([
      api.transfer(body, key),
      api.transfer(body, key),
      api.transfer(body, key),
    ]);
    const ids = new Set(await Promise.all(responses.map(async (r) => (await r.json()).id)));
    expect(ids.size).toBe(1);
    expect(await balance(everyday.id)).toBe(985);
  });

  test('payment to a payee debits only the from account @functional', async () => {
    const payee = await (await api.addPayee(PayeeBuilder.default().build())).json();
    const res = await api.transfer({ fromAccountId: saver.id, payeeId: payee.id, amount: 300 });
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ payeeId: payee.id, toAccountId: null });
    expect(await balance(saver.id)).toBe(4700);
  });

  test('payments over the daily payee limit are refused @negative', async ({
    bankSupport,
    bankApiAs,
    cleanup,
  }) => {
    const customer = await bankSupport.createCustomer({
      dailyLimit: 500,
      accounts: [{ type: 'transaction', balance: 2000 }],
    });
    cleanup.add(`customer ${customer.username}`, () => bankSupport.deleteCustomer(customer.customerId));

    const own = await bankApiAs({ oauth: { user: customer.username, password: customer.password } });
    const payee = await (await own.addPayee(PayeeBuilder.default().build())).json();
    const from = customer.accounts[0]!.id;
    expect((await own.transfer({ fromAccountId: from, payeeId: payee.id, amount: 400 })).status()).toBe(201);
    const over = await own.transfer({ fromAccountId: from, payeeId: payee.id, amount: 100.01 });
    expect(over.status()).toBe(422);
    expect(await over.json()).toMatchObject({ error: 'daily_limit_exceeded' });
  });

  test('transfer can be read back by id @functional', async () => {
    const created = await (
      await api.transfer({ fromAccountId: everyday.id, toAccountId: saver.id, amount: 5 })
    ).json();
    const res = await api.transferById(created.id);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(created);
  });
});
