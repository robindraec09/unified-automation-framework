import { test, expect } from '@qa/test';
import { ApiErrorSchema, CustomerSchema } from '@qa/api';

/** Basic auth, challenges and lockout on the Harbourline API. */
test.describe('Bank API authentication', () => {
  test('health reports app and database up without auth @smoke', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'up' });
  });

  test('no credentials returns 401 with Basic and Bearer challenges @security', async ({ bankApiAs }) => {
    const api = await bankApiAs('none');
    const res = await api.accounts();
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toContain('Basic realm=');
    expect(res.headers()['www-authenticate']).toContain('Bearer realm=');
    await expect(res).toMatchSchema(ApiErrorSchema);
  });

  test('valid Basic credentials identify the customer @smoke', async ({ bankApiAs, config }) => {
    const api = await bankApiAs({ basic: { user: config.bank.user, password: config.bank.password } });
    const res = await api.me();
    expect(res.status()).toBe(200);
    await expect(res).toMatchSchema(CustomerSchema);
    expect(await res.json()).toMatchObject({ username: config.bank.user, authMethod: 'basic' });
  });

  test('wrong Basic password returns 401 invalid_credentials @negative', async ({
    bankApiAs,
    bankCustomer,
  }) => {
    const api = await bankApiAs({ basic: { user: bankCustomer.username, password: 'wrong-password' } });
    const res = await api.me();
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid_credentials' });
  });

  test('three wrong passwords lock the customer, even the right password then fails @security', async ({
    bankApiAs,
    bankCustomer,
  }) => {
    const wrong = await bankApiAs({ basic: { user: bankCustomer.username, password: 'wrong-password' } });
    expect((await wrong.me()).status()).toBe(401);
    expect((await wrong.me()).status()).toBe(401);
    const third = await wrong.me();
    expect(third.status()).toBe(423);
    expect(await third.json()).toMatchObject({ error: 'account_locked' });

    const right = await bankApiAs({
      basic: { user: bankCustomer.username, password: bankCustomer.password },
    });
    expect((await right.me()).status()).toBe(423);
  });

  test('seeded locked customer is refused with 423 @negative', async ({ bankApiAs }) => {
    const api = await bankApiAs({ basic: { user: 'sam.locked', password: 'Harbour#2026' } });
    const res = await api.me();
    expect(res.status()).toBe(423);
    expect(await res.json()).toMatchObject({ error: 'account_locked' });
  });

  test('a successful login resets the failed-attempt counter @functional', async ({
    bankApiAs,
    bankCustomer,
  }) => {
    const wrong = await bankApiAs({ basic: { user: bankCustomer.username, password: 'wrong-password' } });
    const right = await bankApiAs({
      basic: { user: bankCustomer.username, password: bankCustomer.password },
    });
    expect((await wrong.me()).status()).toBe(401);
    expect((await wrong.me()).status()).toBe(401);
    expect((await right.me()).status()).toBe(200);
    // Counter is back to 0, so two more failures still do not lock
    expect((await wrong.me()).status()).toBe(401);
    expect((await wrong.me()).status()).toBe(401);
    expect((await right.me()).status()).toBe(200);
  });
});
