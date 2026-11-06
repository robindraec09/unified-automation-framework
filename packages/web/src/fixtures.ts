import { test as base } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LoginPage } from './pages/login.page';
import { InventoryPage } from './pages/inventory.page';
import {
  AccountDetailPage,
  AccountsPage,
  BankLoginPage,
  PayeesPage,
  TransferPage,
} from './pages/bank/bank.pages';

export type WebFixtures = {
  shop: { login: LoginPage; inventory: InventoryPage };
  /** Harbourline Bank internet banking (apps/bank). */
  bank: {
    login: BankLoginPage;
    accounts: AccountsPage;
    account: AccountDetailPage;
    transfer: TransferPage;
    payees: PayeesPage;
  };
  a11y: () => Promise<{ violations: { id: string; impact?: string | null }[] }>;
};

/** Web fixtures: tests receive intent-level page objects, never raw locators. */
export const webTest = base.extend<WebFixtures>({
  shop: async ({ page }, use) => {
    await use({ login: new LoginPage(page), inventory: new InventoryPage(page) });
  },
  bank: async ({ page }, use) => {
    await use({
      login: new BankLoginPage(page),
      accounts: new AccountsPage(page),
      account: new AccountDetailPage(page),
      transfer: new TransferPage(page),
      payees: new PayeesPage(page),
    });
  },
  a11y: async ({ page }, use) => {
    await use(async () => {
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      return {
        violations: r.violations.map((v: { id: string; impact?: string | null }) => ({
          id: v.id,
          impact: v.impact,
        })),
      };
    });
  },
});
