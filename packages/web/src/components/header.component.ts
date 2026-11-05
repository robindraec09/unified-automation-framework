import type { Locator, Page } from '@playwright/test';

/** Reusable component shared by several pages. */
export class HeaderComponent {
  readonly cartBadge: Locator;
  readonly cartLink: Locator;
  readonly menu: Locator;

  constructor(private readonly page: Page) {
    this.cartBadge = page.getByTestId('shopping-cart-badge');
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.menu = page.getByRole('button', { name: 'Open Menu' });
  }

  async logout() {
    await this.menu.click();
    await this.page.getByRole('link', { name: 'Logout' }).click();
  }
}
