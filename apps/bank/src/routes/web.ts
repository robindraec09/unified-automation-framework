import { Router, type RequestHandler, type Response } from 'express';
import { join } from 'node:path';
import { settings } from '../config';
import { query } from '../db';
import { sha256 } from '../crypto';
import { authenticateCustomer, createSession, readCookie, SESSION_COOKIE } from '../auth';
import { badRequest } from '../errors';

/** Internet-banking UI: static pages + cookie session. Pages call /api/v1 with the session cookie. */
export const web = Router();

const page = (res: Response, file: string) => res.sendFile(join(settings.publicDir, file));

async function hasSession(cookie: string | undefined) {
  if (!cookie) return false;
  const rows = await query('select 1 from sessions where token_hash = $1 and expires_at > now()', [
    sha256(cookie),
  ]);
  return rows.length > 0;
}

/** Pages behind login redirect to /login?next=<path> without a valid session. */
const protectedPage =
  (file: string): RequestHandler =>
  async (req, res) => {
    if (!(await hasSession(readCookie(req, SESSION_COOKIE)))) {
      res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    page(res, file);
  };

web.get('/', (_req, res) => res.redirect(302, '/accounts'));
web.get('/login', (_req, res) => page(res, 'login.html'));
web.get('/accounts', protectedPage('accounts.html'));
web.get('/accounts/:id', protectedPage('account.html'));
web.get('/transfer', protectedPage('transfer.html'));
web.get('/payees', protectedPage('payees.html'));

web.post('/web/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password)
    throw badRequest('Enter your customer ID and password');
  const customerId = await authenticateCustomer(username.trim(), password);
  const token = await createSession(customerId);
  res
    .cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: settings.sessionTtlSec * 1000,
    })
    .json({ ok: true });
});

web.post('/web/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await query('delete from sessions where token_hash = $1', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' }).json({ ok: true });
});
