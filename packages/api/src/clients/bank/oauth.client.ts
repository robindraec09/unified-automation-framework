import { createHash, randomBytes } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';

export interface ClientCredentials {
  clientId: string;
  clientSecret?: string;
  /** client_secret_basic (default) or client_secret_post */
  method?: 'basic' | 'post';
}

/** Raw calls to the OAuth 2.0 endpoints. Returns APIResponse so tests can assert errors too. */
export class OAuthClient {
  constructor(private readonly request: APIRequestContext) {}

  token(form: Record<string, string>, client?: ClientCredentials): Promise<APIResponse> {
    const headers: Record<string, string> = {};
    const body = { ...form };
    if (client?.clientSecret !== undefined && client.method !== 'post') {
      const basic = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`;
      headers.Authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
    } else if (client) {
      body.client_id = client.clientId;
      if (client.clientSecret !== undefined) body.client_secret = client.clientSecret;
    }
    return this.request.post('/oauth/token', { form: body, headers });
  }

  password(client: ClientCredentials, username: string, password: string, scope?: string) {
    return this.token({ grant_type: 'password', username, password, ...(scope ? { scope } : {}) }, client);
  }

  clientCredentials(client: ClientCredentials, scope?: string) {
    return this.token({ grant_type: 'client_credentials', ...(scope ? { scope } : {}) }, client);
  }

  refresh(client: ClientCredentials, refreshToken: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }, client);
  }

  revoke(client: ClientCredentials, token: string) {
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret ?? ''}`).toString('base64');
    return this.request.post('/oauth/revoke', {
      form: { token },
      headers: { Authorization: `Basic ${basic}` },
    });
  }

  /** New PKCE pair (RFC 7636, S256). */
  static pkce() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  }

  /**
   * Drives the authorization endpoint headlessly (sign in + allow) and returns the redirect.
   * Use the web channel instead when the consent page itself is under test.
   */
  async authorize(p: {
    clientId: string;
    redirectUri: string;
    username: string;
    password: string;
    scope?: string;
    codeChallenge?: string;
    state?: string;
    decision?: 'allow' | 'deny';
  }): Promise<{ response: APIResponse; location: URL | null }> {
    const response = await this.request.post('/oauth/authorize', {
      form: {
        response_type: 'code',
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        scope: p.scope ?? '',
        state: p.state ?? randomBytes(8).toString('hex'),
        code_challenge: p.codeChallenge ?? '',
        code_challenge_method: p.codeChallenge ? 'S256' : '',
        username: p.username,
        password: p.password,
        decision: p.decision ?? 'allow',
      },
      maxRedirects: 0,
    });
    const location = response.headers()['location'];
    return { response, location: location ? new URL(location) : null };
  }
}
