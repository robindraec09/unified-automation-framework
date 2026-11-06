import { test as base, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { loadConfig } from '@qa/core';
import { PostsClient } from './clients/posts.client';
import { BankClient } from './clients/bank/bank.client';
import { OAuthClient } from './clients/bank/oauth.client';
import { BankTestSupport, type TestCustomer } from './clients/bank/test-support.client';

/** How a BankClient authenticates. `oauth` uses the password grant with the configured QA client. */
export type BankAuth =
  | { basic: { user: string; password: string } }
  | { bearer: string }
  | { oauth: { user?: string; password?: string; scope?: string } }
  | 'none';

export type ApiFixtures = {
  posts: PostsClient;
  /** Auto: in projects with requiresBank, skips every test when the bank app is down (before any page opens). */
  bankGate: void;
  /** Harbourline API as the configured customer, OAuth bearer token (password grant). */
  bankApi: BankClient;
  /** Harbourline API with any auth: Basic, Bearer, OAuth, or none. */
  bankApiAs: (auth: BankAuth) => Promise<BankClient>;
  /** Raw OAuth 2.0 endpoints, unauthenticated context. */
  oauth: OAuthClient;
  bankSupport: BankTestSupport;
  /** A fresh, isolated customer (default: Everyday $1,000 + Saver $5,000), deleted after the test. */
  bankCustomer: TestCustomer;
};

export type ApiWorkerFixtures = {
  /** True when the bank app answers /health (app up and DB reachable). */
  bankAvailable: boolean;
  /** Set to true by the bank-* projects: their tests skip when the bank app is down. */
  requiresBank: boolean;
};

const BANK_DOWN =
  'Harbourline Bank not reachable: run `pnpm bank:db:init`, then `pnpm test:bank` (auto-starts the app)';

/** One /health check per worker process, shared by the gate and the bank fixtures. */
let bankHealth: Promise<boolean> | undefined;
function bankIsUp(): Promise<boolean> {
  bankHealth ??= (async () => {
    const ctx = await pwRequest.newContext({ baseURL: loadConfig().bank.baseUrl });
    const ok = await ctx
      .get('/health', { timeout: 5_000 })
      .then((r) => r.ok())
      .catch(() => false);
    await ctx.dispose();
    return ok;
  })();
  return bankHealth;
}

/**
 * API fixtures. A dedicated request context per test with the API base URL and auth,
 * so UI and mobile tests can also use these clients to arrange data.
 * Bank fixtures skip the test cleanly when the bank app is not running.
 */
export const apiTest = base.extend<ApiFixtures, ApiWorkerFixtures>({
  posts: async ({}, use) => {
    const cfg = loadConfig();
    const ctx = await pwRequest.newContext({
      baseURL: cfg.api.baseUrl,
      extraHTTPHeaders: cfg.api.token ? { Authorization: `Bearer ${cfg.api.token}` } : {},
    });
    await use(new PostsClient(ctx));
    await ctx.dispose();
  },

  requiresBank: [false, { option: true, scope: 'worker' }],
  bankGate: [
    async ({ requiresBank }, use, testInfo) => {
      // Other projects never ping the bank app: the check only runs when requiresBank is set
      testInfo.skip(requiresBank && !(await bankIsUp()), BANK_DOWN);
      await use();
    },
    { auto: true },
  ],

  bankAvailable: [async ({}, use) => use(await bankIsUp()), { scope: 'worker' }],

  oauth: async ({ bankAvailable }, use, testInfo) => {
    testInfo.skip(!bankAvailable, BANK_DOWN);
    const ctx = await pwRequest.newContext({ baseURL: loadConfig().bank.baseUrl });
    await use(new OAuthClient(ctx));
    await ctx.dispose();
  },

  bankApiAs: async ({ oauth }, use) => {
    const cfg = loadConfig().bank;
    const contexts: APIRequestContext[] = [];
    await use(async (auth) => {
      let header: string | undefined;
      if (auth !== 'none' && 'basic' in auth)
        header = `Basic ${Buffer.from(`${auth.basic.user}:${auth.basic.password}`).toString('base64')}`;
      else if (auth !== 'none' && 'bearer' in auth) header = `Bearer ${auth.bearer}`;
      else if (auth !== 'none' && 'oauth' in auth) {
        const res = await oauth.password(
          { clientId: cfg.clientId, clientSecret: cfg.clientSecret },
          auth.oauth.user ?? cfg.user,
          auth.oauth.password ?? cfg.password,
          auth.oauth.scope,
        );
        if (!res.ok()) throw new Error(`OAuth password grant failed (${res.status()}): ${await res.text()}`);
        header = `Bearer ${(await res.json()).access_token}`;
      }
      const ctx = await pwRequest.newContext({
        baseURL: cfg.baseUrl,
        extraHTTPHeaders: header ? { Authorization: header } : {},
      });
      contexts.push(ctx);
      return new BankClient(ctx, '/api/v1');
    });
    await Promise.all(contexts.map((c) => c.dispose()));
  },

  bankApi: async ({ bankApiAs }, use) => {
    await use(await bankApiAs({ oauth: {} }));
  },

  bankSupport: async ({ bankAvailable }, use, testInfo) => {
    testInfo.skip(!bankAvailable, BANK_DOWN);
    const ctx = await pwRequest.newContext({ baseURL: loadConfig().bank.baseUrl });
    await use(new BankTestSupport(ctx));
    await ctx.dispose();
  },

  bankCustomer: async ({ bankSupport }, use) => {
    const customer = await bankSupport.createCustomer();
    await use(customer);
    await bankSupport.deleteCustomer(customer.customerId);
  },
});
