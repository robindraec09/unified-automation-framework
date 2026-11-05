import { test as base } from '@playwright/test';
import { loadConfig } from '@qa/core';
import { connect, type DbClient } from './db';
import { createPipeline, type PipelineRunner } from './pipeline';

export type EtlWorkerFixtures = {
  sourcePool: DbClient;
  warehousePool: DbClient;
  etlAvailable: boolean;
};
export type EtlFixtures = {
  source: DbClient;
  warehouse: DbClient;
  pipeline: PipelineRunner;
};

/**
 * ETL fixtures: worker-scoped connection pools (lazy: nothing connects unless a test asks for
 * `source`, `warehouse` or `pipeline`), plus a pipeline runner (local demo, Airflow, ...).
 * Tests skip cleanly when the databases are not reachable.
 */
export const etlTest = base.extend<EtlFixtures, EtlWorkerFixtures>({
  sourcePool: [
    async ({}, use) => {
      const db = connect('source', loadConfig().etl.sourceUrl ?? 'postgres://unset');
      await use(db);
      await db.close();
    },
    { scope: 'worker' },
  ],
  warehousePool: [
    async ({}, use) => {
      const db = connect('warehouse', loadConfig().etl.targetUrl ?? 'postgres://unset');
      await use(db);
      await db.close();
    },
    { scope: 'worker' },
  ],
  etlAvailable: [
    async ({ sourcePool, warehousePool }, use) => {
      await use((await sourcePool.ping()) && (await warehousePool.ping()));
    },
    { scope: 'worker' },
  ],
  source: async ({ sourcePool, etlAvailable }, use, testInfo) => {
    testInfo.skip(!etlAvailable, 'ETL databases not reachable (run `pnpm etl:up`)');
    await use(sourcePool);
  },
  warehouse: async ({ warehousePool, etlAvailable }, use, testInfo) => {
    testInfo.skip(!etlAvailable, 'ETL databases not reachable (run `pnpm etl:up`)');
    await use(warehousePool);
  },
  pipeline: async ({ source, warehouse }, use) => {
    await use(createPipeline(loadConfig(), source, warehouse));
  },
});
