import type { Page } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  readonly path = '/';

  readonly username = this.page.getByPlaceholder('Username');
  readonly password = this.page.getByPlaceholder('Password');
  readonly submit = this.page.getByRole('button', { name: 'Login' });
  readonly error = this.page.getByTestId('error');

  constructor(page: Page) {
    super(page);
  }

  async loginAs(user: string, password: string) {
    await this.open();
    await this.username.fill(user);
    await this.password.fill(password);
    await this.submit.click();
  }
}
