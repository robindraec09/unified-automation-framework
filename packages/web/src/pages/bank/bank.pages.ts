import type { Locator, Page } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Page objects for Harbourline Bank (apps/bank). The app follows the data-testid contract,
 * so the bank-web project sets testIdAttribute: 'data-testid'.
 */

/** Formats a number the way the UI does: en-AU currency, e.g. -1320.45 -> "-$1,320.45". */
export const toAud = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);

/** Top bar shown on every signed-in page. */
export class BankNav {
  readonly customerName: Locator;
  readonly logoutButton: Locator;

  constructor(private readonly page: Page) {
    this.customerName = page.getByTestId('customer-name');
    this.logoutButton = page.getByRole('button', { name: 'Log out' });
  }

  link(name: 'Accounts' | 'Transfer & pay' | 'Payees') {
    return this.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name });
  }

  async logout() {
    await this.logoutButton.click();
  }
}

export class BankLoginPage extends BasePage {
  readonly path = '/login';
  readonly heading = this.page.getByRole('heading', { name: 'Log in to Internet Banking' });
  readonly username = this.page.getByLabel('Customer ID');
  readonly password = this.page.getByLabel('Password');
  readonly submit = this.page.getByRole('button', { name: 'Log in' });
  readonly error = this.page.getByTestId('login-error');

  async loginAs(user: string, password: string) {
    await this.open();
    await this.username.fill(user);
    await this.password.fill(password);
    await this.submit.click();
  }
}

export class AccountsPage extends BasePage {
  readonly path = '/accounts';
  readonly heading = this.page.getByRole('heading', { name: 'Your accounts' });
  readonly nav = new BankNav(this.page);
  readonly cards = this.page.getByTestId('account-card');
  readonly netPosition = this.page.getByTestId('net-position');

  card(accountName: string) {
    return this.cards.filter({
      has: this.page.getByTestId('account-name').getByText(accountName, { exact: true }),
    });
  }

  balanceOf(accountName: string) {
    return this.card(accountName).getByTestId('account-balance');
  }

  async openAccount(accountName: string) {
    await this.card(accountName).click();
  }
}

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

export class PayeesPage extends BasePage {
  readonly path = '/payees';
  readonly rows = this.page.getByTestId('payee-row');
  readonly name = this.page.getByLabel('Account name');
  readonly bsb = this.page.getByLabel('BSB');
  readonly accountNumber = this.page.getByLabel('Account number');
  readonly nickname = this.page.getByLabel('Nickname (optional)');
  readonly submit = this.page.getByRole('button', { name: 'Add payee' });
  readonly error = this.page.getByTestId('payee-error');
  readonly success = this.page.getByTestId('payee-success');

  row(name: string) {
    return this.rows.filter({ hasText: name });
  }

  async add(p: { name: string; bsb: string; accountNumber: string; nickname?: string }) {
    await this.name.fill(p.name);
    await this.bsb.fill(p.bsb);
    await this.accountNumber.fill(p.accountNumber);
    if (p.nickname) await this.nickname.fill(p.nickname);
    await this.submit.click();
  }

  /** Deletes via the row button and accepts the browser confirm dialog. */
  async remove(name: string) {
    this.page.once('dialog', (d) => d.accept());
    await this.page.getByRole('button', { name: `Delete payee ${name}` }).click();
  }
}
