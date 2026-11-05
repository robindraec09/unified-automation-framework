import { test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LoginPage } from './pages/login.page';
import { InventoryPage } from './pages/inventory.page';

export type WebFixtures = {
  shop: { login: LoginPage; inventory: InventoryPage };
  a11y: () => Promise<{ violations: { id: string; impact?: string | null }[] }>;
};

/** Web fixtures: tests receive intent-level page objects, never raw locators. */
export const webTest = base.extend<WebFixtures>({
  shop: async ({ page }, use) => {
    await use({ login: new LoginPage(page), inventory: new InventoryPage(page) });
  },
  a11y: async ({ page }, use) => {
    await use(async () => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      return {
        violations: r.violations.map((v: { id: string; impact?: string | null }) => ({ id: v.id, impact: v.impact })),
      };
    });
  },
});
