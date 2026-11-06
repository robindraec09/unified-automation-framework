import { test, expect } from '@qa/test';
import { PayeeListSchema, PayeeSchema, type BankClient } from '@qa/api';
import { PayeeBuilder } from '@qa/data';

test.describe('Bank payees API', () => {
  let api: BankClient;

  test.beforeEach(async ({ bankApiAs, bankCustomer }) => {
    api = await bankApiAs({ basic: { user: bankCustomer.username, password: bankCustomer.password } });
  });

  test('add, list and delete a payee @smoke @functional', async () => {
    const payee = PayeeBuilder.default().withNickname('Mum').build();
    const created = await api.addPayee(payee);
    expect(created.status()).toBe(201);
    await expect(created).toMatchSchema(PayeeSchema);
    const { id } = await created.json();

    const list = await api.payees();
    await expect(list).toMatchSchema(PayeeListSchema);
    expect(await list.json()).toContainEqual({ id, ...payee });

    expect((await api.removePayee(id)).status()).toBe(204);
    expect((await api.removePayee(id)).status()).toBe(404);
  });

  test('duplicate BSB and account number returns 409 @negative', async () => {
    const payee = PayeeBuilder.default().build();
    expect((await api.addPayee(payee)).status()).toBe(201);
    const dup = await api.addPayee({ ...payee, name: 'Someone else' });
    expect(dup.status()).toBe(409);
    expect(await dup.json()).toMatchObject({ error: 'duplicate_payee' });
  });

  for (const [label, override] of [
    ['BSB without dash', { bsb: '123456' }],
    ['short account number', { accountNumber: '123' }],
    ['empty name', { name: '' }],
  ] as const) {
    test(`invalid payee (${label}) returns 400 @negative`, async () => {
      const res = await api.addPayee({ ...PayeeBuilder.default().build(), ...override });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation_error' });
    });
  }
});
