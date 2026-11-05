import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import 'dotenv/config';

/**
 * Typed, validated environment config.
 * Source order: config/env/<TEST_ENV>.json, then environment variables override.
 */
const ConfigSchema = z.object({
  name: z.string(),
  web: z.object({
    baseUrl: z.string().url(),
    user: z.string().default(''),
    password: z.string().default(''),
  }),
  api: z.object({
    baseUrl: z.string().url(),
    token: z.string().optional(),
  }),
  mobile: z.object({
    appiumHost: z.string().default('127.0.0.1'),
    appiumPort: z.coerce.number().default(4723),
    device: z.string().default('android-emulator'),
    cloud: z.enum(['none', 'browserstack', 'saucelabs', 'lambdatest']).default('none'),
    maxDevices: z.coerce.number().default(1),
  }),
  etl: z.object({
    sourceUrl: z.string().optional(),
    targetUrl: z.string().optional(),
    pipeline: z.enum(['local', 'airflow', 'adf', 'glue', 'dbt-cloud']).default('local'),
    orchestratorUrl: z.string().optional(),
    orchestratorToken: z.string().optional(),
    maxDiffRows: z.coerce.number().default(100),
  }),
});

export type FrameworkConfig = z.infer<typeof ConfigSchema>;

let cached: FrameworkConfig | undefined;

export function loadConfig(): FrameworkConfig {
  if (cached) return cached;
  const envName = process.env.TEST_ENV ?? 'dev';
  const file = resolve(process.cwd(), 'config', 'env', `${envName}.json`);
  if (!existsSync(file)) throw new Error(`No config for TEST_ENV=${envName} at ${file}`);
  const fromFile = JSON.parse(readFileSync(file, 'utf8'));
  // `||` not `??`: CI sets unset secrets to "", which must fall back to the file value
  const e = process.env;

  const merged = {
    ...fromFile,
    web: { ...fromFile.web, user: e.WEB_USER || fromFile.web?.user, password: e.WEB_PASSWORD || fromFile.web?.password },
    api: { ...fromFile.api, token: e.API_TOKEN || fromFile.api?.token },
    mobile: {
      ...fromFile.mobile,
      appiumHost: e.APPIUM_HOST || fromFile.mobile?.appiumHost,
      appiumPort: e.APPIUM_PORT || fromFile.mobile?.appiumPort,
      device: e.DEVICE || fromFile.mobile?.device,
      cloud: e.CLOUD || fromFile.mobile?.cloud,
    },
    etl: {
      ...fromFile.etl,
      sourceUrl: e.ETL_SOURCE_URL || fromFile.etl?.sourceUrl,
      targetUrl: e.ETL_TARGET_URL || fromFile.etl?.targetUrl,
      pipeline: e.ETL_PIPELINE || fromFile.etl?.pipeline,
      orchestratorUrl: e.AIRFLOW_URL || fromFile.etl?.orchestratorUrl,
      orchestratorToken: e.AIRFLOW_TOKEN || fromFile.etl?.orchestratorToken,
    },
  };

  cached = ConfigSchema.parse(merged);
  return cached;
}
