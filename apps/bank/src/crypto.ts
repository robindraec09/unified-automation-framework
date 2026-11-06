import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { settings } from './config';

/** scrypt password hash, stored as `scrypt$<salt>$<hash>` (base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Opaque random token (sessions, refresh tokens, auth codes). Only its SHA-256 is stored. */
export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

export interface AccessTokenClaims {
  iss: string;
  aud: string;
  /** `customer:<id>` or `client:<client_id>` */
  sub: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (data: string) => createHmac('sha256', settings.jwtSecret).update(data).digest('base64url');

export function signAccessToken(claims: Omit<AccessTokenClaims, 'iss' | 'aud' | 'iat' | 'exp' | 'jti'>) {
  const now = Math.floor(Date.now() / 1000);
  const full: AccessTokenClaims = {
    iss: settings.publicUrl,
    aud: 'harbourline-api',
    iat: now,
    exp: now + settings.accessTokenTtlSec,
    jti: randomBytes(8).toString('hex'),
    ...claims,
  };
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(full)}`;
  return `${body}.${sign(body)}`;
}

/** Verifies an HS256 JWT. Returns the claims, or null for a bad signature, wrong alg/audience or expiry. */
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AccessTokenClaims;
    if (claims.aud !== 'harbourline-api' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** PKCE S256: base64url(sha256(verifier)) */
export const pkceChallenge = (verifier: string) => sha256(verifier);
