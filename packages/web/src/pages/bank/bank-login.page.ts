import { BasePage } from '../base.page';

// Harbourline Bank (apps/bank) follows the data-testid contract: the bank-web project sets testIdAttribute.
export class BankLoginPage extends BasePage {
  readonly path = '/login';
  readonly heading = this.page.getByRole('heading', { name: 'Log in to Internet Banking' });
  readonly username = this.page.getByLabel('Customer ID');
  readonly password = this.page.getByLabel('Password');
  readonly submit = this.page.getByRole('button', { name: 'Log in' });
  readonly error = this.page.getByTestId('login-error');

  /**
   * Submits the form and waits for the outcome: either the app navigates away from /login (signed in)
   * or the error message appears. The form posts in the background, so returning right after the click
   * would let the next navigation race the session cookie.
   */
  async loginAs(user: string, password: string) {
    await this.open();
    await this.username.fill(user);
    await this.password.fill(password);
    await this.submit.click();
    await Promise.race([
      this.page.waitForURL((url) => url.pathname !== '/login'),
      this.error.waitFor({ state: 'visible' }),
    ]);
  }
}
