import express from 'express';
import { settings } from './config';
import { pool } from './db';
import { errorHandler } from './errors';
import { api } from './routes/api';
import { oauth, oauthMetadata } from './routes/oauth';
import { web } from './routes/web';
import { testSupport } from './routes/test-support';

/**
 * Harbourline Bank: a fictional bank used as the local system under test.
 * One process serves the internet-banking UI, the REST API (/api/v1) and an OAuth 2.0 server (/oauth).
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use('/static', express.static(settings.publicDir, { maxAge: 0 }));

  /** Liveness: the process is up (used by Playwright's webServer). */
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  /** Readiness: the database answers. 503 when it does not. */
  app.get('/health', async (_req, res) => {
    const db = await pool.query('select 1').then(
      () => 'up',
      () => 'down',
    );
    res
      .status(db === 'up' ? 200 : 503)
      .json({ status: db === 'up' ? 'ok' : 'degraded', db, testSupport: settings.testSupport });
  });
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(oauthMetadata));

  app.use('/oauth', oauth);
  app.use('/api/v1', api);
  if (settings.testSupport) app.use('/test-support', testSupport);
  app.use(web);

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'No such route' }));
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  createApp().listen(settings.port, () => {
    console.log(
      `Harbourline Bank listening on ${settings.publicUrl} (test support ${settings.testSupport ? 'ON' : 'off'})`,
    );
  });
}
