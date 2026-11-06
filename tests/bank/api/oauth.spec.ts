import { test, expect } from '@qa/test';
import { OAuthClient, OAuthErrorSchema, TokenResponseSchema } from '@qa/api';
import { loadConfig } from '@qa/core';

/** OAuth 2.0: every grant type, client authentication, scopes, PKCE and refresh-token rotation. */
test.describe('Bank OAuth 2.0', () => {
  test('password grant issues a bearer token with refresh token @smoke @contract', async ({
    oauth,
    config,
  }) => {
    const { clientId, clientSecret, user, password } = config.bank;
    const res = await oauth.password({ clientId, clientSecret }, user, password);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    await expect(res).toMatchSchema(TokenResponseSchema);
    const body = await res.json();
    expect(body.refresh_token).toBeTruthy();
    expect(body.scope.split(' ')).toEqual(expect.arrayContaining(['accounts:read', 'payments:write']));
  });

  test('client_secret_post authenticates the same as client_secret_basic @functional', async ({
    oauth,
    config,
  }) => {
    const { clientId, clientSecret, user, password } = config.bank;
    const res = await oauth.password({ clientId, clientSecret, method: 'post' }, user, password);
    expect(res.status()).toBe(200);
  });

  test('bearer token from the password grant reads accounts @smoke', async ({ bankApi }) => {
    const me = await bankApi.me();
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ authMethod: 'bearer' });
    expect((await bankApi.accounts()).status()).toBe(200);
  });

  test('wrong client secret returns 401 invalid_client @negative @security', async ({ oauth, config }) => {
    const res = await oauth.password(
      { clientId: config.bank.clientId, clientSecret: 'not-the-secret' },
      config.bank.user,
      config.bank.password,
    );
    expect(res.status()).toBe(401);
    await expect(res).toMatchSchema(OAuthErrorSchema);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
  });

  test('wrong user password returns 400 invalid_grant @negative', async ({ oauth, config, bankCustomer }) => {
    const { clientId, clientSecret } = config.bank;
    const res = await oauth.password({ clientId, clientSecret }, bankCustomer.username, 'wrong-password');
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  test('unknown grant type returns unsupported_grant_type @negative', async ({ oauth, config }) => {
    const { clientId, clientSecret } = config.bank;
    const res = await oauth.token({ grant_type: 'implicit' }, { clientId, clientSecret });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  test('client may not use a grant it is not registered for @negative @security', async ({
    oauth,
    config,
  }) => {
    const { clientId, clientSecret } = config.bank;
    const res = await oauth.clientCredentials({ clientId, clientSecret });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unauthorized_client' });
  });

  test('requesting a scope the client does not have returns invalid_scope @negative', async ({
    oauth,
    config,
  }) => {
    const { clientId, clientSecret, user, password } = config.bank;
    const res = await oauth.password(
      { clientId, clientSecret },
      user,
      password,
      'accounts:read customers:read',
    );
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_scope' });
  });

  test('read-only token cannot make payments: 403 insufficient_scope @security', async ({ bankApiAs }) => {
    const readOnly = await bankApiAs({ oauth: { scope: 'accounts:read' } });
    const [account] = await (await readOnly.accounts()).json();
    const res = await readOnly.transfer({
      fromAccountId: account.id,
      toAccountId: account.id + 1,
      amount: 1,
    });
    expect(res.status()).toBe(403);
    expect(res.headers()['www-authenticate']).toContain('error="insufficient_scope"');
    expect(await res.json()).toMatchObject({ error: 'insufficient_scope' });
  });

  test('client_credentials token reaches back-office endpoints only @functional @security', async ({
    oauth,
    bankApiAs,
    config,
  }) => {
    const res = await oauth.clientCredentials({
      clientId: config.bank.opsClientId,
      clientSecret: config.bank.opsClientSecret,
    });
    expect(res.status()).toBe(200);
    const token = await res.json();
    expect(token.refresh_token).toBeUndefined();
    const service = await bankApiAs({ bearer: token.access_token });

    expect((await service.opsCustomerAccounts(1)).status()).toBe(200);
    const customerEndpoint = await service.accounts();
    expect(customerEndpoint.status()).toBe(403);
  });

  test('customer token cannot call back-office endpoints @security', async ({ bankApi }) => {
    expect((await bankApi.opsCustomerAccounts(1)).status()).toBe(403);
  });

  test('tampered access token is rejected with 401 invalid_token @security', async ({
    oauth,
    bankApiAs,
    config,
  }) => {
    const { clientId, clientSecret, user, password } = config.bank;
    const { access_token } = await (await oauth.password({ clientId, clientSecret }, user, password)).json();
    const [header, payload, signature] = access_token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'customer:2' })).toString('base64url');

    const res = await (await bankApiAs({ bearer: `${header}.${forged}.${signature}` })).me();
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid_token' });
  });

  test('refresh token rotates: new token works, the old one is rejected @functional @security', async ({
    oauth,
    config,
  }) => {
    const client = { clientId: config.bank.clientId, clientSecret: config.bank.clientSecret };
    const first = await (await oauth.password(client, config.bank.user, config.bank.password)).json();

    const rotated = await oauth.refresh(client, first.refresh_token);
    expect(rotated.status()).toBe(200);
    const second = await rotated.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);

    const replay = await oauth.refresh(client, first.refresh_token);
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
  });

  test('revoked refresh token can no longer be used @security', async ({ oauth, config }) => {
    const client = { clientId: config.bank.clientId, clientSecret: config.bank.clientSecret };
    const { refresh_token } = await (
      await oauth.password(client, config.bank.user, config.bank.password)
    ).json();
    expect((await oauth.revoke(client, refresh_token)).status()).toBe(200);
    expect((await oauth.refresh(client, refresh_token)).status()).toBe(400);
  });

  test.describe('authorization code + PKCE (public mobile client)', () => {
    const mobile = { clientId: 'harbour-mobile' };
    // Registered for harbour-mobile and qa-automation by the seed (apps/bank/scripts/db-init.ts)
    const redirectUri = `${loadConfig().bank.baseUrl}/oauth/callback`;

    test('code exchanged with the right verifier yields tokens @smoke @functional', async ({
      oauth,
      config,
    }) => {
      const { verifier, challenge } = OAuthClient.pkce();
      const { response, location } = await oauth.authorize({
        clientId: mobile.clientId,
        redirectUri,
        username: config.bank.user,
        password: config.bank.password,
        codeChallenge: challenge,
        state: 'xyz123',
        scope: 'accounts:read transactions:read',
      });
      expect(response.status()).toBe(302);
      expect(location?.searchParams.get('state')).toBe('xyz123');

      const res = await oauth.token(
        {
          grant_type: 'authorization_code',
          code: location!.searchParams.get('code')!,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        },
        mobile,
      );
      expect(res.status()).toBe(200);
      await expect(res).toMatchSchema(TokenResponseSchema);
      expect((await res.json()).scope).toBe('accounts:read transactions:read');
    });

    test('wrong PKCE verifier is rejected @security', async ({ oauth, config }) => {
      const { challenge } = OAuthClient.pkce();
      const { location } = await oauth.authorize({
        clientId: mobile.clientId,
        redirectUri,
        username: config.bank.user,
        password: config.bank.password,
        codeChallenge: challenge,
      });
      const res = await oauth.token(
        {
          grant_type: 'authorization_code',
          code: location!.searchParams.get('code')!,
          redirect_uri: redirectUri,
          code_verifier: OAuthClient.pkce().verifier,
        },
        mobile,
      );
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    });

    test('authorization code cannot be used twice @security', async ({ oauth, config }) => {
      const { verifier, challenge } = OAuthClient.pkce();
      const { location } = await oauth.authorize({
        clientId: mobile.clientId,
        redirectUri,
        username: config.bank.user,
        password: config.bank.password,
        codeChallenge: challenge,
      });
      const exchange = {
        grant_type: 'authorization_code',
        code: location!.searchParams.get('code')!,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      };
      expect((await oauth.token(exchange, mobile)).status()).toBe(200);
      expect((await oauth.token(exchange, mobile)).status()).toBe(400);
    });

    test('public client without PKCE is refused at the authorize endpoint @security', async ({
      oauth,
      config,
    }) => {
      const { response } = await oauth.authorize({
        clientId: mobile.clientId,
        redirectUri,
        username: config.bank.user,
        password: config.bank.password,
      });
      expect(response.status()).toBe(400);
    });

    test('unregistered redirect_uri is refused @security', async ({ oauth, config }) => {
      const { response } = await oauth.authorize({
        clientId: mobile.clientId,
        redirectUri: 'https://attacker.example/callback',
        username: config.bank.user,
        password: config.bank.password,
        codeChallenge: OAuthClient.pkce().challenge,
      });
      expect(response.status()).toBe(400);
    });

    test('denying consent redirects with access_denied @functional', async ({ oauth, config }) => {
      const { location } = await oauth.authorize({
        clientId: mobile.clientId,
        redirectUri,
        username: config.bank.user,
        password: config.bank.password,
        codeChallenge: OAuthClient.pkce().challenge,
        decision: 'deny',
      });
      expect(location?.searchParams.get('error')).toBe('access_denied');
    });
  });
});
