import type { Page } from '@playwright/test';

/**
 * Base for all page objects.
 * Locator policy: getByRole > getByLabel/Placeholder > getByTestId > CSS. No XPath.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  abstract readonly path: string;

  async open() {
    await this.page.goto(this.path);
  }
}
