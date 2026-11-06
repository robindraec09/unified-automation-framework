import type { Locator, Page } from '@playwright/test';
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
