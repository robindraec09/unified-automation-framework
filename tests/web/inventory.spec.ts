import { test, expect } from '@qa/test';

test.describe('Inventory', () => {
  test.beforeEach(async ({ shop }) => {
    await shop.inventory.open();
  });

  test('adding an item updates the cart badge @smoke', async ({ shop }) => {
    await shop.inventory.addToCart('Sauce Labs Backpack');
    await expect(shop.inventory.header.cartBadge).toHaveText('1');
  });

  test('products page has no serious accessibility violations @a11y', async ({ a11y }) => {
    const { violations } = await a11y();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    // Demo app has known issues: report them, fail only once the baseline is clean
    test.info().annotations.push({ type: 'a11y', description: JSON.stringify(serious) });
    expect.soft(serious, 'serious/critical axe violations').toEqual([]);
  });
});
