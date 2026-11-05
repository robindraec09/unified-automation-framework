import type { Page } from '@playwright/test';
import { BasePage } from './base.page';
import { HeaderComponent } from '../components/header.component';

export class InventoryPage extends BasePage {
  readonly path = '/inventory.html';

  readonly title = this.page.getByTestId('title');
  readonly header = new HeaderComponent(this.page);

  constructor(page: Page) {
    super(page);
  }

  item(name: string) {
    return this.page.getByTestId('inventory-item').filter({ hasText: name });
  }

  async addToCart(name: string) {
    await this.item(name).getByRole('button', { name: 'Add to cart' }).click();
  }
}
