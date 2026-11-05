type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;

function write(level: Level, scope: string, msg: string, data?: unknown) {
  if (order[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, scope, msg, ...(data ? { data } : {}) };
  // JSON lines: easy to ship to any log store and to read for the triage agent
  console.log(JSON.stringify(line));
}

export const logger = (scope: string) => ({
  debug: (m: string, d?: unknown) => write('debug', scope, m, d),
  info: (m: string, d?: unknown) => write('info', scope, m, d),
  warn: (m: string, d?: unknown) => write('warn', scope, m, d),
  error: (m: string, d?: unknown) => write('error', scope, m, d),
});
