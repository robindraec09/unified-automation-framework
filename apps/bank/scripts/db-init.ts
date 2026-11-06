/**
 * Creates (optionally) and seeds the Harbourline Bank database.
 *
 *   pnpm bank:db:init              reset to the seed state (drops all bank data)
 *   tsx db-init.ts --if-empty      seed only when the schema does not exist yet (used by the container)
 *
 * BANK_DB_URL        app connection, default postgres://bank_app:bank_app@localhost:5435/bank (Docker)
 * BANK_DB_ADMIN_URL  optional superuser connection, e.g. postgres://postgres:<pw>@localhost:5432/postgres.
 *                    When set, the role and database in BANK_DB_URL are created if missing.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword } from '../src/crypto';

const appUrl = process.env.BANK_DB_URL ?? 'postgres://bank_app:bank_app@localhost:5435/bank';
const ifEmpty = process.argv.includes('--if-empty');
const adminUrl = process.env.BANK_DB_ADMIN_URL;
const root = process.env.QA_ROOT ?? process.cwd();
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
};

async function ensureRoleAndDatabase() {
  if (!adminUrl) return;
  const u = new URL(appUrl);
  const role = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  const database = u.pathname.slice(1);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const roleExists = (await admin.query('select 1 from pg_roles where rolname = $1', [role])).rowCount;
    const pw = `'${password.replace(/'/g, "''")}'`;
    await admin.query(
      roleExists
        ? `alter role ${ident(role)} with login password ${pw}`
        : `create role ${ident(role)} with login password ${pw}`,
    );
    const dbExists = (await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount;
    if (!dbExists) await admin.query(`create database ${ident(database)} owner ${ident(role)}`);
    console.log(`role ${role} and database ${database} ready`);
  } finally {
    await admin.end();
  }
}

/** Deterministic PRNG so every reset produces the same history. */
function rng(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

const MERCHANTS = [
  ['Coles Supermarket', -8650],
  ['Woolworths Metro', -4220],
  ['Opal Travel', -1580],
  ['Harbour Cafe', -650],
  ['Netflix', -1899],
  ['City Power & Gas', -14230],
  ['Pharmacy Direct', -2795],
  ['Bunnings Warehouse', -6340],
  ['Transfer from J Chen', 5000],
  ['Salary ACME PTY LTD', 412500],
] as const;

async function seed(c: pg.Client) {
  const hash = hashPassword('Harbour#2026');
  const customers = [
    ['alex.morgan', 'Alex Morgan', 'alex.morgan@example.test', 'active'],
    ['jordan.lee', 'Jordan Lee', 'jordan.lee@example.test', 'active'],
    ['sam.locked', 'Sam Locked', 'sam.locked@example.test', 'locked'],
  ];
  const ids: Record<string, number> = {};
  for (const [username, name, email, status] of customers) {
    const r = await c.query<{ id: number }>(
      `insert into customers (username, full_name, email, password_hash, status) values ($1,$2,$3,$4,$5) returning id`,
      [username, name, email, hash, status],
    );
    ids[username!] = r.rows[0]!.id;
  }

  // [customer, name, type, accountNumber, final balance cents, credit limit cents]
  const accounts = [
    ['alex.morgan', 'Everyday Account', 'transaction', '10000001', 524050, 0],
    ['alex.morgan', 'Bonus Saver', 'savings', '10000002', 1825000, 0],
    ['alex.morgan', 'Low Rate Card', 'credit', '10000003', -132045, 600000],
    ['jordan.lee', 'Everyday Account', 'transaction', '20000001', 210000, 0],
    ['sam.locked', 'Everyday Account', 'transaction', '30000001', 50000, 0],
  ] as const;

  const rand = rng(42);
  for (const [who, name, type, number, finalCents, limit] of accounts) {
    const acct = (
      await c.query<{ id: number }>(
        `insert into accounts (customer_id, name, type, bsb, account_number, balance_cents, credit_limit_cents)
         values ($1,$2,$3,'999-001',$4,$5,$6) returning id`,
        [ids[who], name, type, number, finalCents, limit],
      )
    ).rows[0]!.id;

    // History: 20 movements over the last 60 days, ending exactly at the final balance
    const moves = Array.from({ length: type === 'savings' ? 6 : 20 }, () => {
      const m = MERCHANTS[Math.floor(rand() * MERCHANTS.length)]!;
      return type === 'savings' ? (['Interest', 2150] as const) : m;
    });
    let balance = finalCents - moves.reduce((s, [, amt]) => s + amt, 0);
    const start = Date.now() - 61 * 86_400_000;
    await c.query(
      `insert into transactions (account_id, posted_at, description, amount_cents, balance_after_cents) values ($1,$2,'Opening balance',$3,$3)`,
      [acct, new Date(start), balance],
    );
    for (const [i, [desc, amt]] of moves.entries()) {
      balance += amt;
      const at = new Date(start + (i + 1) * Math.floor((60 * 86_400_000) / moves.length));
      await c.query(
        `insert into transactions (account_id, posted_at, description, amount_cents, balance_after_cents) values ($1,$2,$3,$4,$5)`,
        [acct, at, desc, amt, balance],
      );
    }
  }

  const payees = [
    ['alex.morgan', 'Jamie Chen', '123-456', '87654321', 'Jamie'],
    ['alex.morgan', 'Sunrise Property Mgmt', '234-567', '11223344', 'Rent'],
    ['jordan.lee', 'Taylor Brooks', '345-678', '55667788', null],
  ];
  for (const [who, name, bsb, number, nick] of payees)
    await c.query(
      'insert into payees (customer_id, name, bsb, account_number, nickname) values ($1,$2,$3,$4,$5)',
      [ids[who!], name, bsb, number, nick],
    );

  const userScopes = ['accounts:read', 'transactions:read', 'payees:read', 'payees:write', 'payments:write'];
  // The public callback, plus any extra hosts the app is reached by (e.g. http://bank-app:4000 inside Docker)
  const callbacks = [
    `${process.env.BANK_PUBLIC_URL ?? 'http://localhost:4000'}/oauth/callback`,
    ...(process.env.BANK_REDIRECT_URIS ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
  ];
  const clients = [
    [
      'qa-automation',
      'qa-automation-secret',
      'QA Automation',
      ['password', 'refresh_token', 'authorization_code'],
      userScopes,
      callbacks,
    ],
    [
      'ops-service',
      'ops-service-secret',
      'Back-office Service',
      ['client_credentials'],
      ['customers:read'],
      [],
    ],
    [
      'harbour-mobile',
      null,
      'Harbourline Mobile',
      ['authorization_code', 'refresh_token'],
      userScopes,
      callbacks,
    ],
  ] as const;
  for (const [id, secret, name, grants, scopes, redirects] of clients)
    await c.query(
      `insert into oauth_clients (client_id, client_secret_hash, name, grant_types, scopes, redirect_uris) values ($1,$2,$3,$4,$5,$6)`,
      [id, secret ? hashPassword(secret) : null, name, grants, scopes, redirects],
    );
}

async function main() {
  await ensureRoleAndDatabase();
  const c = new pg.Client({ connectionString: appUrl });
  await c.connect();
  if (ifEmpty) {
    const { rows } = await c.query<{ t: string | null }>(`select to_regclass('bank.customers')::text t`);
    if (rows[0]?.t) {
      console.log('Harbourline Bank schema already present; keeping existing data (--if-empty)');
      await c.end();
      return;
    }
  }
  try {
    await c.query('begin');
    await c.query(readFileSync(resolve(root, 'apps/bank/db/schema.sql'), 'utf8'));
    await seed(c);
    await c.query('commit');
    console.log(`Harbourline Bank database seeded at ${appUrl.replace(/:[^:@/]*@/, ':***@')}`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
