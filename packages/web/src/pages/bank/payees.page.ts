import { BasePage } from '../base.page';

// Harbourline Bank (apps/bank) follows the data-testid contract: the bank-web project sets testIdAttribute.
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
