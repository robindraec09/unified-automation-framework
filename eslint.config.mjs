import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default tseslint.config(
  { ignores: ['node_modules', 'playwright-report', 'test-results', 'allure-*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Playwright fixtures that use no other fixtures are written `async ({}, use) => …`
      'no-empty-pattern': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['tests/**/*.ts', 'seed/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-focused-test': 'error',
      'playwright/no-raw-locators': 'warn',
      'playwright/prefer-web-first-assertions': 'error',
      // Gating a whole file on the environment (e.g. mobile needs Appium) is intended; bare .skip() is not
      'playwright/no-skipped-test': ['warn', { allowConditional: true }],
      // expect.configure(...) wrappers named expectXxx count as assertions
      'playwright/expect-expect': ['warn', { assertFunctionPatterns: ['^expect[A-Z]\\w*$'] }],
    },
  },
);
