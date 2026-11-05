import { mergeTests, mergeExpects, expect as baseExpect, test as base } from '@playwright/test';
import { loadConfig, type FrameworkConfig } from '@qa/core';
import { CleanupRegistry } from '@qa/data';
import { webTest } from '@qa/web';
import { apiTest, apiExpect } from '@qa/api';
import { mobileTest } from '@qa/mobile';
import { etlTest } from '@qa/etl';

const coreTest = base.extend<{ config: FrameworkConfig; cleanup: CleanupRegistry }>({
  config: async ({}, use) => use(loadConfig()),
  cleanup: async ({}, use) => {
    const registry = new CleanupRegistry();
    await use(registry);
    await registry.runAll();
  },
});

/**
 * The single entry point for every spec:
 *   import { test, expect } from '@qa/test';
 * Fixtures are lazy, so a web test never opens an Appium session or a DB pool.
 */
export const test = mergeTests(coreTest, webTest, apiTest, mobileTest, etlTest);
export const expect = mergeExpects(baseExpect, apiExpect);
