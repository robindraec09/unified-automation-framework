import { BaseScreen } from '../base.screen';
import { HARBOURLINE_PACKAGE, harbourlineId } from './ids';

/** Harbourline Mobile accounts overview. */
export class AccountsScreen extends BaseScreen {
  readonly title = harbourlineId('accounts_title');
  readonly customerName = harbourlineId('customer_name');
  readonly netPosition = harbourlineId('net_position');
  readonly transferButton = harbourlineId('transfer_button');
  readonly logoutButton = harbourlineId('logout_button');

  async waitUntilShown() {
    await this.waitFor(this.title, 30_000);
  }

  /** Each row's content description starts with the account name: "Everyday Account, account ..., balance ..." */
  private row(accountName: string) {
    return this.driver.$(
      `android=new UiSelector().resourceId("${HARBOURLINE_PACKAGE}:id/account_row").descriptionStartsWith("${accountName},")`,
    );
  }

  /** Waits for the row, then returns its balance text, e.g. "$1,000.00". */
  async balanceOf(accountName: string) {
    const row = this.row(accountName);
    await row.waitForDisplayed({ timeout: 15_000 });
    return row.$(harbourlineId('account_balance')).getText();
  }

  /** Waits until the account shows `expected` (balances reload when the screen resumes). */
  async waitForBalance(accountName: string, expected: string, timeout = 15_000) {
    await this.driver.waitUntil(async () => (await this.balanceOf(accountName)) === expected, {
      timeout,
      timeoutMsg: `${accountName} never showed ${expected}`,
    });
  }

  async customer() {
    await this.waitUntilShown();
    return this.el(this.customerName).getText();
  }

  async openTransfer() {
    await this.el(this.transferButton).click();
  }

  async logout() {
    await this.el(this.logoutButton).click();
  }
}
