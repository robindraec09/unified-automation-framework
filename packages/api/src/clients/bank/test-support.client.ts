import type { APIRequestContext } from '@playwright/test';

export interface CustomerSpec {
  fullName?: string;
  password?: string;
  status?: 'active' | 'locked';
  dailyLimit?: number;
  accounts?: {
    type: 'transaction' | 'savings' | 'credit';
    name?: string;
    balance?: number;
    creditLimit?: number;
  }[];
}

export interface TestCustomer {
  customerId: number;
  username: string;
  password: string;
  accounts: { id: number; type: string; name: string; accountNumber: string; balance: number }[];
}

/** Creates and removes throwaway `qa_*` customers via the app's /test-support endpoints. */
export class BankTestSupport {
  constructor(private readonly request: APIRequestContext) {}

  async createCustomer(spec: CustomerSpec = {}): Promise<TestCustomer> {
    const res = await this.request.post('/test-support/customers', { data: spec });
    if (res.status() !== 201)
      throw new Error(
        `test-support create failed (${res.status()}): ${await res.text()}. Is BANK_TEST_SUPPORT=1?`,
      );
    return res.json();
  }

  async deleteCustomer(id: number) {
    await this.request.delete(`/test-support/customers/${id}`);
  }
}
