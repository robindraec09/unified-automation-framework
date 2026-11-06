import 'dotenv/config';
import { resolve } from 'node:path';

/** Harbourline Bank app settings. Everything has a local default; override in .env. */
export const settings = {
  port: Number(process.env.BANK_PORT ?? 4000),
  publicUrl: process.env.BANK_PUBLIC_URL ?? `http://localhost:${process.env.BANK_PORT ?? 4000}`,
  dbUrl: process.env.BANK_DB_URL ?? 'postgres://bank_app:bank_app@localhost:5435/bank',
  /** HS256 signing key for access tokens. Local demo default only. */
  jwtSecret: process.env.BANK_JWT_SECRET ?? 'harbourline-local-dev-secret-change-me',
  accessTokenTtlSec: Number(process.env.BANK_ACCESS_TOKEN_TTL ?? 900),
  refreshTokenTtlSec: 7 * 24 * 3600,
  sessionTtlSec: 30 * 60,
  maxFailedLogins: 3,
  /** Enables /test-support endpoints that create and delete throwaway customers. Never on in production. */
  testSupport: process.env.BANK_TEST_SUPPORT === '1',
  publicDir: resolve(process.env.QA_ROOT ?? process.cwd(), 'apps/bank/public'),
} as const;

/** Scopes a customer can hold. Service (client_credentials) scopes are separate. */
export const CUSTOMER_SCOPES = [
  'accounts:read',
  'transactions:read',
  'payees:read',
  'payees:write',
  'payments:write',
] as const;
export const SERVICE_SCOPES = ['customers:read'] as const;
