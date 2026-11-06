import type { Locator } from '@playwright/test';
import { BasePage } from '../base.page';
import { BankNav } from '../../components/bank-nav.component';

// Harbourline Bank (apps/bank) follows the data-testid contract: the bank-web project sets testIdAttribute.
export class TransferPage extends BasePage {
  readonly path = '/transfer';
  readonly nav = new BankNav(this.page);
  readonly from = this.page.getByLabel('From account');
  readonly toMyAccount = this.page.getByRole('radio', { name: 'My account' });
  readonly toPayee = this.page.getByRole('radio', { name: 'A payee' });
  readonly to = this.page.getByLabel('To account');
  readonly payee = this.page.getByLabel('Payee', { exact: true });
  readonly amount = this.page.getByLabel('Amount (AUD)');
  readonly description = this.page.getByLabel('Description');
  readonly submit = this.page.getByRole('button', { name: 'Transfer' });
  readonly error = this.page.getByTestId('transfer-error');
  readonly receipt = this.page.getByTestId('transfer-receipt');
  readonly receiptId = this.page.getByTestId('receipt-id');
  readonly receiptSummary = this.page.getByTestId('receipt-summary');

  /** Options carry balances in their label, so pick by the account or payee name they contain. */
  private async choose(select: Locator, containing: string) {
    const value = await select.locator('option', { hasText: containing }).first().getAttribute('value');
    if (!value) throw new Error(`No option containing "${containing}"`);
    await select.selectOption(value);
  }

  async transferBetween(fromAccount: string, toAccount: string, amount: string, description = '') {
    await this.choose(this.from, fromAccount);
    await this.toMyAccount.check();
    await this.choose(this.to, toAccount);
    await this.amount.fill(amount);
    await this.description.fill(description);
    await this.submit.click();
  }

  async payPayee(fromAccount: string, payeeName: string, amount: string, description = '') {
    await this.choose(this.from, fromAccount);
    await this.toPayee.check();
    await this.choose(this.payee, payeeName);
    await this.amount.fill(amount);
    await this.description.fill(description);
    await this.submit.click();
  }
}
