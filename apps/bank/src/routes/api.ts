import { Router } from 'express';
import { z } from 'zod';
import { authenticate, customerId, principalOf, requireScope } from '../auth';
import { maybeOne, query, tx } from '../db';
import { ApiError, badRequest, notFound } from '../errors';

/** Customer banking API, mounted at /api/v1. Every route needs Basic, Bearer or a web session. */
export const api = Router();
api.use(authenticate);

const dollars = (cents: number) => Math.round(cents) / 100;

interface AccountRow {
  id: number;
  customer_id: number;
  name: string;
  type: 'transaction' | 'savings' | 'credit';
  bsb: string;
  account_number: string;
  balance_cents: number;
  credit_limit_cents: number;
  currency: string;
}

const toAccount = (a: AccountRow) => ({
  id: a.id,
  name: a.name,
  type: a.type,
  bsb: a.bsb,
  accountNumber: a.account_number,
  balance: dollars(a.balance_cents),
  availableBalance: dollars(a.balance_cents + a.credit_limit_cents),
  currency: a.currency,
});

async function ownedAccount(customer: number, id: number): Promise<AccountRow> {
  // Another customer's account is reported as not found, so ids cannot be probed
  const a = await maybeOne<AccountRow>('select * from accounts where id = $1 and customer_id = $2', [
    id,
    customer,
  ]);
  if (!a) throw notFound('Account');
  return a;
}

const idParam = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound('Resource');
  return n;
};

api.get('/me', async (req, res) => {
  const me = await maybeOne<{ id: number; username: string; full_name: string; email: string }>(
    'select id, username, full_name, email from customers where id = $1',
    [customerId(req)],
  );
  if (!me) throw notFound('Customer');
  res.json({
    id: me.id,
    username: me.username,
    fullName: me.full_name,
    email: me.email,
    authMethod: principalOf(req)!.method,
  });
});

api.get('/accounts', requireScope('accounts:read'), async (req, res) => {
  const rows = await query<AccountRow>('select * from accounts where customer_id = $1 order by id', [
    customerId(req),
  ]);
  res.json(rows.map(toAccount));
});

api.get('/accounts/:id', requireScope('accounts:read'), async (req, res) => {
  res.json(toAccount(await ownedAccount(customerId(req), idParam(req.params.id))));
});

const TxQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

api.get('/accounts/:id/transactions', requireScope('transactions:read'), async (req, res) => {
  const account = await ownedAccount(customerId(req), idParam(req.params.id));
  const q = TxQuery.safeParse(req.query);
  if (!q.success) throw badRequest('Invalid query parameters', q.error.issues);
  const rows = await query<{
    id: number;
    posted_at: Date;
    description: string;
    amount_cents: number;
    balance_after_cents: number;
    transfer_id: string | null;
  }>(
    `select id, posted_at, description, amount_cents, balance_after_cents, transfer_id from transactions
      where account_id = $1 and ($2::date is null or posted_at >= $2::date) and ($3::date is null or posted_at < $3::date + 1)
      order by posted_at desc, id desc limit $4`,
    [account.id, q.data.from ?? null, q.data.to ?? null, q.data.limit],
  );
  res.json(
    rows.map((t) => ({
      id: t.id,
      postedAt: t.posted_at.toISOString(),
      description: t.description,
      amount: dollars(t.amount_cents),
      type: t.amount_cents < 0 ? 'debit' : 'credit',
      balanceAfter: dollars(t.balance_after_cents),
      transferId: t.transfer_id,
    })),
  );
});

// ---- Payees ----

const PayeeBody = z.object({
  name: z.string().trim().min(1).max(80),
  bsb: z.string().regex(/^\d{3}-\d{3}$/, 'BSB must look like 123-456'),
  accountNumber: z.string().regex(/^\d{6,9}$/, 'Account number must be 6 to 9 digits'),
  nickname: z.string().trim().max(40).optional(),
});

const toPayee = (p: {
  id: number;
  name: string;
  bsb: string;
  account_number: string;
  nickname: string | null;
}) => ({
  id: p.id,
  name: p.name,
  bsb: p.bsb,
  accountNumber: p.account_number,
  nickname: p.nickname,
});

api.get('/payees', requireScope('payees:read'), async (req, res) => {
  const rows = await query<Parameters<typeof toPayee>[0]>(
    'select * from payees where customer_id = $1 order by name, id',
    [customerId(req)],
  );
  res.json(rows.map(toPayee));
});

api.post('/payees', requireScope('payees:write'), async (req, res) => {
  const body = PayeeBody.safeParse(req.body);
  if (!body.success) throw badRequest('Invalid payee', body.error.issues);
  const p = body.data;
  try {
    const [row] = await query<Parameters<typeof toPayee>[0]>(
      `insert into payees (customer_id, name, bsb, account_number, nickname) values ($1, $2, $3, $4, $5) returning *`,
      [customerId(req), p.name, p.bsb, p.accountNumber, p.nickname ?? null],
    );
    res.status(201).location(`/api/v1/payees/${row!.id}`).json(toPayee(row!));
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new ApiError(409, 'duplicate_payee', 'A payee with this BSB and account number already exists');
    throw e;
  }
});

api.delete('/payees/:id', requireScope('payees:write'), async (req, res) => {
  const rows = await query('delete from payees where id = $1 and customer_id = $2 returning id', [
    idParam(req.params.id),
    customerId(req),
  ]);
  if (!rows.length) throw notFound('Payee');
  res.status(204).end();
});

// ---- Transfers ----

const TransferBody = z
  .object({
    fromAccountId: z.number().int().positive(),
    toAccountId: z.number().int().positive().optional(),
    payeeId: z.number().int().positive().optional(),
    amount: z
      .number()
      .positive('Amount must be greater than 0')
      .max(1_000_000)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
        message: 'Amount can have at most 2 decimal places',
      }),
    description: z.string().trim().max(140).default(''),
  })
  .refine((b) => (b.toAccountId === undefined) !== (b.payeeId === undefined), {
    message: 'Provide exactly one of toAccountId or payeeId',
  })
  .refine((b) => b.fromAccountId !== b.toAccountId, { message: 'Cannot transfer to the same account' });

interface TransferRow {
  id: string;
  from_account_id: number;
  to_account_id: number | null;
  payee_id: number | null;
  amount_cents: number;
  description: string;
  status: string;
  created_at: Date;
}

const toTransfer = (t: TransferRow) => ({
  id: t.id,
  fromAccountId: t.from_account_id,
  toAccountId: t.to_account_id,
  payeeId: t.payee_id,
  amount: dollars(t.amount_cents),
  description: t.description,
  status: t.status,
  createdAt: t.created_at.toISOString(),
});

/**
 * Moves money atomically: locks both accounts, checks funds and the daily payee limit,
 * writes the transfer and one ledger row per side. An `Idempotency-Key` header makes retries safe.
 */
api.post('/transfers', requireScope('payments:write'), async (req, res) => {
  const customer = customerId(req);
  const body = TransferBody.safeParse(req.body);
  if (!body.success) throw badRequest('Invalid transfer', body.error.issues);
  const t = body.data;
  const cents = Math.round(t.amount * 100);
  const key = req.get('Idempotency-Key') ?? null;

  if (key) {
    const existing = await maybeOne<TransferRow>(
      'select * from transfers where customer_id = $1 and idempotency_key = $2',
      [customer, key],
    );
    if (existing) {
      res.status(200).set('Idempotent-Replayed', 'true').json(toTransfer(existing));
      return;
    }
  }

  const transfer = await tx(async (c) => {
    const ids = [t.fromAccountId, t.toAccountId]
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => a - b);
    const locked = (
      await c.query<AccountRow>(
        'select * from accounts where id = any($1) and customer_id = $2 order by id for update',
        [ids, customer],
      )
    ).rows;
    const from = locked.find((a) => a.id === t.fromAccountId);
    if (!from) throw notFound('From account');
    const to = t.toAccountId ? locked.find((a) => a.id === t.toAccountId) : undefined;
    if (t.toAccountId && !to) throw notFound('To account');

    let payeeName = '';
    if (t.payeeId) {
      const payee = (
        await c.query<{ name: string }>('select name from payees where id = $1 and customer_id = $2', [
          t.payeeId,
          customer,
        ])
      ).rows[0];
      if (!payee) throw notFound('Payee');
      payeeName = payee.name;
      const { sent } = (
        await c.query<{ sent: number }>(
          `select coalesce(sum(amount_cents), 0)::bigint sent from transfers
            where customer_id = $1 and payee_id is not null and created_at >= date_trunc('day', now())`,
          [customer],
        )
      ).rows[0]!;
      const { daily_limit_cents } = (
        await c.query<{ daily_limit_cents: number }>(
          'select daily_limit_cents from customers where id = $1',
          [customer],
        )
      ).rows[0]!;
      if (sent + cents > daily_limit_cents)
        throw new ApiError(
          422,
          'daily_limit_exceeded',
          `This payment would exceed your daily limit of $${dollars(daily_limit_cents)}`,
        );
    }

    if (from.balance_cents + from.credit_limit_cents < cents)
      throw new ApiError(422, 'insufficient_funds', 'Insufficient available funds in the from account');

    const row = (
      await c.query<TransferRow>(
        `insert into transfers (customer_id, from_account_id, to_account_id, payee_id, amount_cents, description, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [customer, from.id, to?.id ?? null, t.payeeId ?? null, cents, t.description, key],
      )
    ).rows[0]!;

    const fromAfter = from.balance_cents - cents;
    await c.query('update accounts set balance_cents = $2 where id = $1', [from.id, fromAfter]);
    const label = t.description || (to ? `Transfer to ${to.name}` : `Payment to ${payeeName}`);
    await c.query(
      `insert into transactions (account_id, transfer_id, description, amount_cents, balance_after_cents) values ($1, $2, $3, $4, $5)`,
      [from.id, row.id, label, -cents, fromAfter],
    );
    if (to) {
      const toAfter = to.balance_cents + cents;
      await c.query('update accounts set balance_cents = $2 where id = $1', [to.id, toAfter]);
      await c.query(
        `insert into transactions (account_id, transfer_id, description, amount_cents, balance_after_cents) values ($1, $2, $3, $4, $5)`,
        [to.id, row.id, t.description || `Transfer from ${from.name}`, cents, toAfter],
      );
    }
    return row;
  }).catch(async (e) => {
    // Two concurrent requests with the same key: the loser returns the winner's transfer
    if ((e as { code?: string }).code === '23505' && key) {
      const existing = await maybeOne<TransferRow>(
        'select * from transfers where customer_id = $1 and idempotency_key = $2',
        [customer, key],
      );
      if (existing) return { ...existing, replayed: true };
    }
    throw e;
  });

  if ('replayed' in transfer) {
    res.status(200).set('Idempotent-Replayed', 'true').json(toTransfer(transfer));
    return;
  }
  res.status(201).location(`/api/v1/transfers/${transfer.id}`).json(toTransfer(transfer));
});

api.get('/transfers/:id', requireScope('accounts:read'), async (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Transfer');
  const row = await maybeOne<TransferRow>('select * from transfers where id = $1 and customer_id = $2', [
    id,
    customerId(req),
  ]);
  if (!row) throw notFound('Transfer');
  res.json(toTransfer(row));
});

// ---- Back-office (service clients via client_credentials) ----

api.get('/ops/customers/:id/accounts', requireScope('customers:read'), async (req, res) => {
  if (principalOf(req)?.kind !== 'service')
    throw new ApiError(403, 'forbidden', 'Back-office endpoints require a service client token');
  const rows = await query<AccountRow>('select * from accounts where customer_id = $1 order by id', [
    idParam(req.params.id),
  ]);
  res.json(rows.map(toAccount));
});
