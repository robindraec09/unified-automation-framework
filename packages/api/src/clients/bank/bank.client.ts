import { BaseClient } from '../base.client';

export interface TransferRequest {
  fromAccountId: number;
  toAccountId?: number;
  payeeId?: number;
  amount: number;
  description?: string;
}

export interface PayeeRequest {
  name: string;
  bsb: string;
  accountNumber: string;
  nickname?: string;
}

/** Harbourline Bank customer API (/api/v1). Auth is set on the request context by the fixture. */
export class BankClient extends BaseClient {
  me() {
    return this.get('/me');
  }

  accounts() {
    return this.get('/accounts');
  }

  account(id: number) {
    return this.get(`/accounts/${id}`);
  }

  transactions(accountId: number, params?: { limit?: number; from?: string; to?: string }) {
    return this.get(`/accounts/${accountId}/transactions`, params);
  }

  payees() {
    return this.get('/payees');
  }

  addPayee(payee: PayeeRequest) {
    return this.post('/payees', payee);
  }

  removePayee(id: number) {
    return this.delete(`/payees/${id}`);
  }

  transfer(body: TransferRequest, idempotencyKey?: string) {
    return this.post('/transfers', body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
  }

  transferById(id: string) {
    return this.get(`/transfers/${id}`);
  }

  /** Back-office endpoint: needs a client_credentials token with customers:read. */
  opsCustomerAccounts(customerId: number) {
    return this.get(`/ops/customers/${customerId}/accounts`);
  }
}
