import { BasePage } from '../base.page';

// Harbourline Bank (apps/bank) follows the data-testid contract: the bank-web project sets testIdAttribute.
export class AccountDetailPage extends BasePage {
  readonly path = '/accounts';
  readonly name = this.page.getByTestId('account-name');
  readonly balance = this.page.getByTestId('account-balance');
  readonly error = this.page.getByTestId('page-error');
  readonly transactions = this.page.getByTestId('transactions');
  readonly rows = this.page.getByTestId('transaction-row');

  async openById(id: number) {
    await this.page.goto(`${this.path}/${id}`);
  }

  row(description: string) {
    return this.rows.filter({ hasText: description });
  }
}
