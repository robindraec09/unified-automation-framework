import { BaseScreen } from '../base.screen';
import { harbourlineId } from './ids';

/**
 * Harbourline Mobile (apps/harbourline-android) sign-in screen.
 * The app uses Android resource ids, not test ids in content descriptions, so TalkBack reads real labels.
 */
export class BankLoginScreen extends BaseScreen {
  readonly title = harbourlineId('login_title');
  readonly customerId = harbourlineId('customer_id');
  readonly password = harbourlineId('password');
  readonly submit = harbourlineId('login_button');
  readonly error = harbourlineId('login_error');

  async waitUntilShown() {
    await this.waitFor(this.title, 60_000);
  }

  /** True once the sign-in screen is on display (waits for it). */
  async isShown() {
    await this.waitUntilShown();
    return this.el(this.title).isDisplayed();
  }

  async loginAs(user: string, password: string) {
    await this.waitUntilShown();
    await this.el(this.customerId).setValue(user);
    await this.el(this.password).setValue(password);
    await this.el(this.submit).click();
  }

  async errorText() {
    await this.waitFor(this.error);
    return this.el(this.error).getText();
  }
}
