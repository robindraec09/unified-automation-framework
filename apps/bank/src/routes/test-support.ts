import { Router } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { tx, query } from '../db';
import { hashPassword } from '../crypto';
import { badRequest, notFound } from '../errors';

/**
 * Test-data endpoints, mounted only when BANK_TEST_SUPPORT=1.
 * Each test creates its own throwaway customer (username `qa_*`) so tests never share balances,
 * and deletes it afterwards. Seeded customers can never be deleted here.
 */
export const testSupport = Router();

const CustomerSpec = z.object({
  fullName: z.string().default('QA Test Customer'),
  password: z.string().min(8).default('Harbour#Test1'),
  status: z.enum(['active', 'locked']).default('active'),
  dailyLimit: z.number().positive().default(10_000),
  accounts: z
    .array(
      z.object({
        type: z.enum(['transaction', 'savings', 'credit']),
        name: z.string().optional(),
        balance: z.number().default(0),
        creditLimit: z.number().nonnegative().default(0),
      }),
    )
    .default([
      { type: 'transaction', balance: 1000, creditLimit: 0 },
      { type: 'savings', balance: 5000, creditLimit: 0 },
    ]),
});

const defaultName = { transaction: 'Everyday Account', savings: 'Saver Account', credit: 'Low Rate Card' };

testSupport.post('/customers', async (req, res) => {
  const spec = CustomerSpec.safeParse(req.body ?? {});
  if (!spec.success) throw badRequest('Invalid customer spec', spec.error.issues);
  const s = spec.data;
  const username = `qa_${randomBytes(5).toString('hex')}`;

  const created = await tx(async (c) => {
    const { id } = (
      await c.query<{ id: number }>(
        `insert into customers (username, full_name, email, password_hash, status, daily_limit_cents)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          username,
          s.fullName,
          `${username}@example.test`,
          hashPassword(s.password),
          s.status,
          Math.round(s.dailyLimit * 100),
        ],
      )
    ).rows[0]!;
    const accounts = [];
    for (const a of s.accounts) {
      const cents = Math.round(a.balance * 100);
      const row = (
        await c.query<{ id: number; account_number: string }>(
          `insert into accounts (customer_id, name, type, bsb, account_number, balance_cents, credit_limit_cents)
           values ($1, $2, $3, '999-001', $4, $5, $6) returning id, account_number`,
          [
            id,
            a.name ?? defaultName[a.type],
            a.type,
            String(randomInt(10_000_000, 99_999_999)),
            cents,
            Math.round(a.creditLimit * 100),
          ],
        )
      ).rows[0]!;
      await c.query(
        `insert into transactions (account_id, description, amount_cents, balance_after_cents) values ($1, 'Opening balance', $2, $2)`,
        [row.id, cents],
      );
      accounts.push({
        id: row.id,
        type: a.type,
        name: a.name ?? defaultName[a.type],
        accountNumber: row.account_number,
        balance: a.balance,
      });
    }
    return { customerId: id, username, password: s.password, accounts };
  });
  res.status(201).json(created);
});

testSupport.delete('/customers/:id', async (req, res) => {
  const rows = await query(`delete from customers where id = $1 and username like 'qa\\_%' returning id`, [
    Number(req.params.id),
  ]);
  if (!rows.length) throw notFound('Test customer');
  res.status(204).end();
});
