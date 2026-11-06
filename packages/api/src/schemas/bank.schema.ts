import { z } from 'zod';

/** Contracts for the Harbourline Bank API (apps/bank). Amounts are AUD dollars with at most 2 decimals. */
const money = z.number().refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'at most 2 decimals');

export const TokenResponseSchema = z.object({
  access_token: z.string().regex(/^[\w-]+\.[\w-]+\.[\w-]+$/, 'JWT'),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  refresh_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const OAuthErrorSchema = z.object({ error: z.string(), message: z.string() });

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const CustomerSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  authMethod: z.enum(['basic', 'bearer', 'session']),
});

export const AccountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  type: z.enum(['transaction', 'savings', 'credit']),
  bsb: z.string().regex(/^\d{3}-\d{3}$/),
  accountNumber: z.string().regex(/^\d{6,9}$/),
  balance: money,
  availableBalance: money,
  currency: z.literal('AUD'),
});
export const AccountListSchema = z.array(AccountSchema);
export type Account = z.infer<typeof AccountSchema>;

export const TransactionSchema = z.object({
  id: z.number().int().positive(),
  postedAt: z.string().datetime(),
  description: z.string(),
  amount: money,
  type: z.enum(['debit', 'credit']),
  balanceAfter: money,
  transferId: z.string().uuid().nullable(),
});
export const TransactionListSchema = z.array(TransactionSchema);
export type Transaction = z.infer<typeof TransactionSchema>;

export const PayeeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  bsb: z.string().regex(/^\d{3}-\d{3}$/),
  accountNumber: z.string().regex(/^\d{6,9}$/),
  nickname: z.string().nullable(),
});
export const PayeeListSchema = z.array(PayeeSchema);

export const TransferSchema = z.object({
  id: z.string().uuid(),
  fromAccountId: z.number().int(),
  toAccountId: z.number().int().nullable(),
  payeeId: z.number().int().nullable(),
  amount: money,
  description: z.string(),
  status: z.literal('completed'),
  createdAt: z.string().datetime(),
});
export type Transfer = z.infer<typeof TransferSchema>;
