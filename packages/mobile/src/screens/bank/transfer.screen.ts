import { BaseScreen } from '../base.screen';
import { harbourlineId } from './ids';

/** Harbourline Mobile transfer between own accounts. */
export class TransferScreen extends BaseScreen {
  readonly title = harbourlineId('transfer_title');
  readonly from = harbourlineId('from_spinner');
  readonly to = harbourlineId('to_spinner');
  readonly amount = harbourlineId('amount');
  readonly description = harbourlineId('description');
  readonly submit = harbourlineId('transfer_submit');
  readonly error = harbourlineId('transfer_error');
  readonly receipt = harbourlineId('transfer_receipt');
  readonly receiptSummary = harbourlineId('receipt_summary');
  readonly receiptId = harbourlineId('receipt_id');
  readonly backToAccounts = harbourlineId('back_to_accounts');

  /** Spinner options read "Everyday Account (12345678) $1,000.00": pick by the name they start with. */
  private async choose(spinner: string, accountName: string) {
    await this.el(spinner).click();
    const option = this.driver.$(`android=new UiSelector().textStartsWith("${accountName} (")`);
    await option.waitForDisplayed({ timeout: 10_000 });
    await option.click();
  }

  async transferBetween(fromAccount: string, toAccount: string, amount: string, description = '') {
    await this.waitFor(this.title, 30_000);
    // The submit button is enabled once the accounts have loaded into the spinners
    await this.driver.waitUntil(() => this.el(this.submit).isEnabled(), { timeout: 15_000 });
    await this.choose(this.from, fromAccount);
    await this.choose(this.to, toAccount);
    await this.el(this.amount).setValue(amount);
    if (description) await this.el(this.description).setValue(description);
    await this.driver.hideKeyboard().catch(() => undefined);
    await this.el(this.submit).click();
  }

  async receiptText() {
    await this.waitFor(this.receipt, 15_000);
    return {
      summary: await this.el(this.receiptSummary).getText(),
      id: await this.el(this.receiptId).getText(),
    };
  }

  async errorText() {
    await this.waitFor(this.error);
    return this.el(this.error).getText();
  }

  async done() {
    await this.el(this.backToAccounts).click();
  }
}
