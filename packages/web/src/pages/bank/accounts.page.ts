import { BasePage } from '../base.page';
import { BankNav } from '../../components/bank-nav.component';

// Harbourline Bank (apps/bank) follows the data-testid contract: the bank-web project sets testIdAttribute.
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
