import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CUSTOMER_SCOPES, settings } from './config';
import { maybeOne, query } from './db';
import { randomToken, sha256, verifyAccessToken, verifyPassword } from './crypto';
import { ApiError } from './errors';

export type Principal =
  | {
      kind: 'customer';
      customerId: number;
      scopes: string[];
      method: 'basic' | 'bearer' | 'session';
      clientId?: string;
    }
  | { kind: 'service'; clientId: string; scopes: string[]; method: 'bearer' };

/** The authenticated caller per request (avoids augmenting Express's Request type). */
const principals = new WeakMap<Request, Principal>();
export const principalOf = (req: Request): Principal | undefined => principals.get(req);

const CHALLENGE = { 'WWW-Authenticate': 'Basic realm="Harbourline API", Bearer realm="Harbourline API"' };
export const SESSION_COOKIE = 'hb_session';

/**
 * Checks a customer's username/password, applying lockout: after `maxFailedLogins` consecutive
 * failures the customer is locked. Shared by Basic auth, the web login and the OAuth password grant.
 */
export async function authenticateCustomer(username: string, password: string): Promise<number> {
  const c = await maybeOne<{ id: number; password_hash: string; status: string; failed_attempts: number }>(
    'select id, password_hash, status, failed_attempts from customers where username = $1',
    [username],
  );
  if (!c) throw new ApiError(401, 'invalid_credentials', 'Username or password is incorrect');
  if (c.status === 'locked')
    throw new ApiError(423, 'account_locked', 'This account is locked. Please contact Harbourline support.');

  if (!verifyPassword(password, c.password_hash)) {
    const attempts = c.failed_attempts + 1;
    const lock = attempts >= settings.maxFailedLogins;
    await query('update customers set failed_attempts = $2, status = $3 where id = $1', [
      c.id,
      attempts,
      lock ? 'locked' : 'active',
    ]);
    if (lock)
      throw new ApiError(423, 'account_locked', 'Too many failed attempts. This account is now locked.');
    throw new ApiError(401, 'invalid_credentials', 'Username or password is incorrect');
  }
  if (c.failed_attempts) await query('update customers set failed_attempts = 0 where id = $1', [c.id]);
  return c.id;
}

export async function createSession(customerId: number): Promise<string> {
  const token = randomToken();
  await query(`insert into sessions values ($1, $2, now() + make_interval(secs => $3))`, [
    sha256(token),
    customerId,
    settings.sessionTtlSec,
  ]);
  return token;
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

async function sessionCustomer(req: Request): Promise<number | undefined> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return undefined;
  const row = await maybeOne<{ customer_id: number }>(
    'select customer_id from sessions where token_hash = $1 and expires_at > now()',
    [sha256(token)],
  );
  return row?.customer_id;
}

/**
 * Resolves the caller from (in order) `Authorization: Basic`, `Authorization: Bearer`, or the web
 * session cookie. Responds 401 with a WWW-Authenticate challenge when none is valid.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const [scheme, value = ''] = header.split(' ');

  if (/^basic$/i.test(scheme ?? '')) {
    const decoded = Buffer.from(value, 'base64').toString();
    const sep = decoded.indexOf(':');
    if (sep < 0) throw new ApiError(401, 'invalid_credentials', 'Malformed Basic credentials', CHALLENGE);
    try {
      const customerId = await authenticateCustomer(decoded.slice(0, sep), decoded.slice(sep + 1));
      principals.set(req, { kind: 'customer', customerId, scopes: [...CUSTOMER_SCOPES], method: 'basic' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw new ApiError(401, e.code, e.message, CHALLENGE);
      throw e;
    }
    return next();
  }

  if (/^bearer$/i.test(scheme ?? '')) {
    const claims = verifyAccessToken(value);
    if (!claims)
      throw new ApiError(401, 'invalid_token', 'Access token is invalid or expired', {
        'WWW-Authenticate': 'Bearer realm="Harbourline API", error="invalid_token"',
      });
    const scopes = claims.scope.split(' ').filter(Boolean);
    const [kind, id = ''] = claims.sub.split(':');
    principals.set(
      req,
      kind === 'customer'
        ? { kind: 'customer', customerId: Number(id), scopes, method: 'bearer', clientId: claims.client_id }
        : { kind: 'service', clientId: id, scopes, method: 'bearer' },
    );
    return next();
  }

  const customerId = await sessionCustomer(req);
  if (customerId) {
    principals.set(req, { kind: 'customer', customerId, scopes: [...CUSTOMER_SCOPES], method: 'session' });
    return next();
  }
  throw new ApiError(401, 'unauthorized', 'Authentication required', CHALLENGE);
};

/** 403 unless the caller holds `scope` (RFC 6750 insufficient_scope). */
export const requireScope =
  (scope: string): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!principals.get(req)?.scopes.includes(scope))
      throw new ApiError(403, 'insufficient_scope', `This operation requires the "${scope}" scope`, {
        'WWW-Authenticate': `Bearer realm="Harbourline API", error="insufficient_scope", scope="${scope}"`,
      });
    next();
  };

/** Customer-facing endpoints: service tokens are rejected. Returns the customer id. */
export function customerId(req: Request): number {
  const p = principals.get(req);
  if (p?.kind !== 'customer')
    throw new ApiError(403, 'forbidden', 'This endpoint requires a customer identity');
  return p.customerId;
}
