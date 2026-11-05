import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '@qa/core';

/**
 * Capabilities come from config/devices/<DEVICE>.json.
 * The Playwright project name (android | ios) picks a default device.
 */
export function loadCapabilities(projectName: string): WebdriverIO.Capabilities {
  const cfg = loadConfig();
  const device =
    process.env.DEVICE ?? (projectName === 'ios' ? 'ios-simulator' : cfg.mobile.device || 'android-emulator');
  const file = resolve(process.cwd(), 'config', 'devices', `${device}.json`);
  const raw = readFileSync(file, 'utf8').replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
  return JSON.parse(raw);
}

export function connectionOptions() {
  const cfg = loadConfig();
  if (cfg.mobile.cloud === 'browserstack') {
    return {
      hostname: 'hub.browserstack.com',
      port: 443,
      protocol: 'https' as const,
      user: process.env.CLOUD_USER,
      key: process.env.CLOUD_KEY,
    };
  }
  return { hostname: cfg.mobile.appiumHost, port: cfg.mobile.appiumPort, path: '/' };
}
