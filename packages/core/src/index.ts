export { loadConfig, type FrameworkConfig } from './config';
export { logger } from './logger';

/** Storage-state files written by the setup project, one per role. */
export const AUTH = {
  standardUser: '.auth/standard-user.json',
} as const;
