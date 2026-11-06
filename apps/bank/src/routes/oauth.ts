import { Router, type Request } from 'express';
import { settings } from '../config';
import { maybeOne, query } from '../db';
import { pkceChallenge, randomToken, sha256, signAccessToken, verifyPassword } from '../crypto';
import { ApiError } from '../errors';
import { authenticateCustomer } from '../auth';

/**
 * OAuth 2.0 authorization server (RFC 6749 + PKCE RFC 7636 + revocation RFC 7009).
 * Grants: password, client_credentials, authorization_code (+PKCE), refresh_token.
 * Client auth: client_secret_basic or client_secret_post; public clients must use PKCE.
 */
export const oauth = Router();

interface Client {
  client_id: string;
  client_secret_hash: string | null;
  name: string;
  grant_types: string[];
  scopes: string[];
  redirect_uris: string[];
}

const oauthError = (status: number, code: string, message: string) =>
  new ApiError(
    status,
    code,
    message,
    status === 401 ? { 'WWW-Authenticate': 'Basic realm="Harbourline OAuth"' } : {},
  );

const findClient = (id: string) => maybeOne<Client>('select * from oauth_clients where client_id = $1', [id]);

/** Authenticates the client from the Basic header or the body. Public clients pass with no secret. */
async function authenticateClient(req: Request): Promise<Client> {
  let id: string | undefined = req.body?.client_id;
  let secret: string | undefined = req.body?.client_secret;
  const [scheme, value = ''] = (req.headers.authorization ?? '').split(' ');
  if (/^basic$/i.test(scheme ?? '')) {
    const decoded = Buffer.from(value, 'base64').toString();
    const sep = decoded.indexOf(':');
    id = decodeURIComponent(decoded.slice(0, sep));
    secret = decodeURIComponent(decoded.slice(sep + 1));
  }
  if (!id) throw oauthError(401, 'invalid_client', 'Client authentication failed');
  const client = await findClient(id);
  if (!client) throw oauthError(401, 'invalid_client', 'Client authentication failed');
  if (client.client_secret_hash && !(secret && verifyPassword(secret, client.client_secret_hash)))
    throw oauthError(401, 'invalid_client', 'Client authentication failed');
  return client;
}

/** Requested scopes must be a subset of the client's; none requested = all of the client's. */
function grantScopes(client: Client, requested?: string): string[] {
  const scopes = requested ? requested.split(' ').filter(Boolean) : client.scopes;
  const bad = scopes.filter((s) => !client.scopes.includes(s));
  if (bad.length)
    throw oauthError(400, 'invalid_scope', `Scope not allowed for this client: ${bad.join(', ')}`);
  return scopes;
}

async function issueRefreshToken(client: Client, customerId: number, scopes: string[]) {
  if (!client.grant_types.includes('refresh_token')) return undefined;
  const token = randomToken();
  await query(
    `insert into refresh_tokens (token_hash, client_id, customer_id, scopes, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [sha256(token), client.client_id, customerId, scopes, settings.refreshTokenTtlSec],
  );
  return token;
}

async function customerTokens(client: Client, customerId: number, scopes: string[]) {
  return {
    access_token: signAccessToken({
      sub: `customer:${customerId}`,
      client_id: client.client_id,
      scope: scopes.join(' '),
    }),
    token_type: 'Bearer',
    expires_in: settings.accessTokenTtlSec,
    scope: scopes.join(' '),
    refresh_token: await issueRefreshToken(client, customerId, scopes),
  };
}

oauth.post('/token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body ?? {};
  const grant = body.grant_type as string | undefined;
  if (!grant) throw oauthError(400, 'invalid_request', 'grant_type is required');
  const client = await authenticateClient(req);
  const known = ['password', 'client_credentials', 'authorization_code', 'refresh_token'];
  if (!known.includes(grant))
    throw oauthError(400, 'unsupported_grant_type', `Unsupported grant_type: ${grant}`);
  if (!client.grant_types.includes(grant))
    throw oauthError(400, 'unauthorized_client', `Client may not use the ${grant} grant`);
  if (!client.client_secret_hash && grant !== 'authorization_code' && grant !== 'refresh_token')
    throw oauthError(401, 'invalid_client', 'Public clients must use authorization_code with PKCE');

  if (grant === 'client_credentials') {
    const scopes = grantScopes(client, body.scope);
    res.json({
      access_token: signAccessToken({
        sub: `client:${client.client_id}`,
        client_id: client.client_id,
        scope: scopes.join(' '),
      }),
      token_type: 'Bearer',
      expires_in: settings.accessTokenTtlSec,
      scope: scopes.join(' '),
    });
    return;
  }

  if (grant === 'password') {
    if (!body.username || !body.password)
      throw oauthError(400, 'invalid_request', 'username and password are required');
    const scopes = grantScopes(client, body.scope);
    let customerId: number;
    try {
      customerId = await authenticateCustomer(body.username, body.password);
    } catch (e) {
      // RFC 6749: bad resource-owner credentials are invalid_grant (400), whatever the cause
      if (e instanceof ApiError) throw oauthError(400, 'invalid_grant', e.message);
      throw e;
    }
    res.json(await customerTokens(client, customerId, scopes));
    return;
  }

  if (grant === 'authorization_code') {
    const row = await maybeOne<{
      customer_id: number;
      client_id: string;
      redirect_uri: string;
      scopes: string[];
      code_challenge: string | null;
    }>(
      `update oauth_codes set used = true
        where code_hash = $1 and not used and expires_at > now()
        returning customer_id, client_id, redirect_uri, scopes, code_challenge`,
      [sha256(String(body.code ?? ''))],
    );
    if (!row || row.client_id !== client.client_id || row.redirect_uri !== body.redirect_uri)
      throw oauthError(400, 'invalid_grant', 'Authorization code is invalid, expired or already used');
    if (row.code_challenge && pkceChallenge(String(body.code_verifier ?? '')) !== row.code_challenge)
      throw oauthError(400, 'invalid_grant', 'PKCE verification failed');
    res.json(await customerTokens(client, row.customer_id, row.scopes));
    return;
  }

  // refresh_token: rotate. The presented token is revoked and a new pair is issued.
  const row = await maybeOne<{ customer_id: number; scopes: string[] }>(
    `update refresh_tokens set revoked = true
      where token_hash = $1 and client_id = $2 and not revoked and expires_at > now()
      returning customer_id, scopes`,
    [sha256(String(body.refresh_token ?? '')), client.client_id],
  );
  if (!row) throw oauthError(400, 'invalid_grant', 'Refresh token is invalid, expired or revoked');
  const scopes = body.scope ? grantScopes({ ...client, scopes: row.scopes }, body.scope) : row.scopes;
  res.json(await customerTokens(client, row.customer_id, scopes));
});

oauth.post('/revoke', async (req, res) => {
  const client = await authenticateClient(req);
  await query('update refresh_tokens set revoked = true where token_hash = $1 and client_id = $2', [
    sha256(String(req.body?.token ?? '')),
    client.client_id,
  ]);
  res.status(200).end(); // RFC 7009: 200 even for unknown tokens
});

// ---- Authorization endpoint (sign-in + consent page) ----

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const AUTH_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
];

async function validateAuthorizeRequest(p: Record<string, string>) {
  const client = await findClient(p.client_id ?? '');
  if (!client || !client.redirect_uris.includes(p.redirect_uri ?? ''))
    throw new ApiError(400, 'invalid_request', 'Unknown client_id or unregistered redirect_uri');
  if (p.response_type !== 'code')
    throw new ApiError(400, 'unsupported_response_type', 'response_type must be code');
  if (!client.grant_types.includes('authorization_code'))
    throw new ApiError(400, 'unauthorized_client', 'Client may not use authorization_code');
  if (!client.client_secret_hash && !p.code_challenge)
    throw new ApiError(400, 'invalid_request', 'Public clients must send a PKCE code_challenge');
  if (p.code_challenge && (p.code_challenge_method ?? 'plain') !== 'S256')
    throw new ApiError(400, 'invalid_request', 'Only code_challenge_method=S256 is supported');
  return { client, scopes: grantScopes(client, p.scope) };
}

function authorizePage(p: Record<string, string>, clientName: string, scopes: string[], error?: string) {
  const hidden = AUTH_PARAMS.map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorise access | Harbourline Bank</title><link rel="stylesheet" href="/static/styles.css"></head>
<body class="auth-body"><main class="auth-card" aria-labelledby="consent-heading">
<div class="brand brand-lg"><span class="brand-mark" aria-hidden="true">H</span> Harbourline Bank</div>
<h1 id="consent-heading">Authorise ${esc(clientName)}</h1>
<p><strong>${esc(clientName)}</strong> is asking to access your Harbourline accounts with these permissions:</p>
<ul class="scope-list" data-testid="consent-scopes">${scopes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
${error ? `<div class="alert alert-error" role="alert" data-testid="consent-error">${esc(error)}</div>` : ''}
<form method="post" action="/oauth/authorize">${hidden}
<label for="username">Customer ID</label><input id="username" name="username" autocomplete="username" required>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<div class="row"><button class="btn btn-primary" type="submit" name="decision" value="allow">Allow access</button>
<button class="btn btn-secondary" type="submit" name="decision" value="deny" formnovalidate>Deny</button></div>
</form></main></body></html>`;
}

const redirectWith = (uri: string, params: Record<string, string | undefined>) => {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
};

oauth.get('/authorize', async (req, res) => {
  const p = req.query as Record<string, string>;
  const { client, scopes } = await validateAuthorizeRequest(p);
  res.type('html').send(authorizePage(p, client.name, scopes));
});

oauth.post('/authorize', async (req, res) => {
  const p = req.body as Record<string, string>;
  const { client, scopes } = await validateAuthorizeRequest(p);
  if (p.decision === 'deny') {
    res.redirect(302, redirectWith(p.redirect_uri!, { error: 'access_denied', state: p.state }));
    return;
  }
  let customerId: number;
  try {
    customerId = await authenticateCustomer(p.username ?? '', p.password ?? '');
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    res
      .status(e.status)
      .type('html')
      .send(authorizePage(p, client.name, scopes, e.message));
    return;
  }
  const code = randomToken();
  await query(
    `insert into oauth_codes (code_hash, client_id, customer_id, redirect_uri, scopes, code_challenge, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + interval '2 minutes')`,
    [sha256(code), client.client_id, customerId, p.redirect_uri, scopes, p.code_challenge || null],
  );
  res.redirect(302, redirectWith(p.redirect_uri!, { code, state: p.state }));
});

/** Registered redirect target for local clients: shows the code so a person can copy it. */
oauth.get('/callback', (req, res) => {
  res.type('html').send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OAuth callback | Harbourline Bank</title>
<link rel="stylesheet" href="/static/styles.css"></head><body class="auth-body"><main class="auth-card">
<h1>OAuth callback</h1><dl><dt>code</dt><dd data-testid="oauth-code">${esc(req.query.code)}</dd>
<dt>state</dt><dd data-testid="oauth-state">${esc(req.query.state)}</dd>
<dt>error</dt><dd data-testid="oauth-error">${esc(req.query.error)}</dd></dl></main></body></html>`,
  );
});

export const oauthMetadata = {
  issuer: settings.publicUrl,
  authorization_endpoint: `${settings.publicUrl}/oauth/authorize`,
  token_endpoint: `${settings.publicUrl}/oauth/token`,
  revocation_endpoint: `${settings.publicUrl}/oauth/revoke`,
  grant_types_supported: ['password', 'client_credentials', 'authorization_code', 'refresh_token'],
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  scopes_supported: [
    'accounts:read',
    'transactions:read',
    'payees:read',
    'payees:write',
    'payments:write',
    'customers:read',
  ],
};
