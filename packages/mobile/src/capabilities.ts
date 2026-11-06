import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '@qa/core';

/**
 * Capabilities come from config/devices/<device>.json. The device is, in order: the DEVICE env var,
 * the project's `mobileDevice` option, then a default per project (ios-simulator for ios, else the
 * configured mobile.device). `${VAR}` placeholders are filled from the environment.
 */
export function loadCapabilities(projectName: string, projectDevice?: string): WebdriverIO.Capabilities {
  const cfg = loadConfig();
  const device =
    process.env.DEVICE ??
    projectDevice ??
    (projectName === 'ios' ? 'ios-simulator' : cfg.mobile.device || 'android-emulator');
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

/** True when the Appium server answers /status (local or Docker; a device cloud is assumed up). */
export async function appiumIsUp(): Promise<boolean> {
  const cfg = loadConfig();
  if (cfg.mobile.cloud !== 'none') return true;
  try {
    const res = await fetch(`http://${cfg.mobile.appiumHost}:${cfg.mobile.appiumPort}/status`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
