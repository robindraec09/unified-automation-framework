#!/usr/bin/env node
/**
 * Framework MCP server: exposes OUR framework to agents (planner/generator/healer, mobile, API, ETL, triage),
 * so generated tests use our page objects, fixtures and data builders instead of raw locators.
 *
 * Run: pnpm mcp:framework   (stdio transport; registered in .mcp.json)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.env.QA_ROOT ?? process.cwd());
const LAST_RUN = join(ROOT, 'test-results', 'mcp-last-run.json');

/** The subset of Playwright's JSON reporter output that get_last_failures reads. */
interface JsonReportSuite {
  title: string;
  suites?: JsonReportSuite[];
  specs?: {
    title: string;
    file: string;
    line: number;
    tests?: {
      projectName: string;
      results?: {
        status: string;
        error?: { message?: string };
        attachments?: { name: string; path?: string }[];
      }[];
    }[];
  }[];
}
const ALLOWED_PROJECTS = ['api', 'web-chromium', 'web-firefox', 'web-webkit', 'mobile-web', 'android', 'ios', 'etl'];
const BLOCKED_ENVS = ['prod', 'production'];

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

/** Lists exported classes and their public members from a folder of TS files. */
function describeObjects(dir: string) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => {
      const src = readFileSync(join(abs, f), 'utf8');
      const cls = src.match(/export (?:abstract )?class (\w+)/)?.[1];
      const members = [...src.matchAll(/^\s{2}(?:readonly |async )?(\w+)\s*(?:=|\()/gm)]
        .map((m) => m[1])
        .filter((m): m is string => !!m && m !== 'constructor' && !m.startsWith('_'));
      return { file: join(dir, f), class: cls, members: [...new Set(members)] };
    });
}

const server = new McpServer({ name: 'unified-automation-framework', version: '0.1.0' });

server.registerTool(
  'list_page_objects',
  {
    description:
      'List page objects, components (web) and screen objects (mobile) with their public members. ' +
      'Generated tests MUST use these instead of raw locators.',
    inputSchema: { channel: z.enum(['web', 'mobile', 'all']).default('all') },
  },
  async ({ channel }) => {
    const out: Record<string, unknown> = {};
    if (channel !== 'mobile') out.web = [...describeObjects('packages/web/src/pages'), ...describeObjects('packages/web/src/components')];
    if (channel !== 'web') out.mobile = describeObjects('packages/mobile/src/screens');
    return text(out);
  },
);

server.registerTool(
  'list_fixtures',
  { description: 'Describe the fixtures available from `import { test, expect } from "@qa/test"`.', inputSchema: {} },
  async () =>
    text({
      import: "import { test, expect } from '@qa/test';",
      fixtures: {
        config: 'Typed environment config (web, api, mobile, etl)',
        cleanup: 'cleanup.add(label, fn): undo actions run after the test, even on failure',
        shop: 'Web page objects: shop.login, shop.inventory (+ header component)',
        a11y: 'Runs axe (WCAG 2 A/AA) on the current page, returns violations',
        posts: 'API client for the posts service (list, byId, create, remove)',
        app: 'Mobile screen objects (Appium via WebdriverIO, worker-scoped driver)',
        source: 'ETL source DB client: query(sql, params), one(sql, params)',
        warehouse: 'ETL warehouse DB client',
        pipeline: "ETL pipeline runner: pipeline.run('orders_daily', { runDate })",
      },
      matchers: { toMatchSchema: 'await expect(apiResponse).toMatchSchema(ZodSchema)' },
      dataBuilders: ['PostBuilder', 'OrderBuilder'],
      tags: ['@smoke', '@regression', '@contract', '@functional', '@negative', '@a11y', '@device', '@etl', '@recon', '@dq'],
    }),
);

server.registerTool(
  'get_env_config',
  { description: 'Return the non-secret config for an environment.', inputSchema: { env: z.string().default('dev') } },
  async ({ env }) => {
    const file = join(ROOT, 'config', 'env', `${env}.json`);
    if (!existsSync(file)) return text(`No config for env '${env}'`);
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    const redact = (o: unknown): unknown =>
      o && typeof o === 'object'
        ? Object.fromEntries(
            Object.entries(o).map(([k, v]) => [k, /password|token|key|secret|url$/i.test(k) && typeof v === 'string' ? '***' : redact(v)]),
          )
        : o;
    return text(redact(cfg));
  },
);

server.registerTool(
  'run_tests',
  {
    description:
      'Run Playwright tests for one project, optionally filtered by tag or title (grep). ' +
      'Returns a pass/fail summary; details via get_last_failures. Production is blocked.',
    inputSchema: {
      project: z.enum(ALLOWED_PROJECTS as [string, ...string[]]),
      grep: z.string().optional(),
      env: z.string().default('dev'),
    },
  },
  async ({ project, grep, env }) => {
    if (BLOCKED_ENVS.includes(env)) return text('Refused: agents may not run tests against production.');
    const args = ['playwright', 'test', `--project=${project}`, '--reporter=json'];
    if (grep) args.push('--grep', grep);
    const code = await new Promise<number>((done) => {
      const child = spawn('npx', args, {
        cwd: ROOT,
        env: { ...process.env, TEST_ENV: env, PLAYWRIGHT_JSON_OUTPUT_NAME: LAST_RUN },
        stdio: 'ignore',
      });
      child.on('close', (c) => done(c ?? 1));
    });
    if (!existsSync(LAST_RUN)) return text({ exitCode: code, error: 'No JSON report produced' });
    const report = JSON.parse(readFileSync(LAST_RUN, 'utf8'));
    return text({ exitCode: code, stats: report.stats });
  },
);

server.registerTool(
  'get_last_failures',
  { description: 'Failures from the last run_tests call: title, file, error message, attachments.', inputSchema: {} },
  async () => {
    if (!existsSync(LAST_RUN)) return text('No previous run.');
    const report = JSON.parse(readFileSync(LAST_RUN, 'utf8'));
    const failures: unknown[] = [];
    const walk = (suite: JsonReportSuite, path: string[] = []) => {
      for (const s of suite.suites ?? []) walk(s, [...path, s.title]);
      for (const spec of suite.specs ?? [])
        for (const t of spec.tests ?? [])
          for (const r of t.results ?? [])
            if (r.status === 'failed' || r.status === 'timedOut')
              failures.push({
                title: [...path, spec.title].filter(Boolean).join(' > '),
                file: `${spec.file}:${spec.line}`,
                project: t.projectName,
                error: (r.error?.message ?? '').slice(0, 2000),
                attachments: (r.attachments ?? []).map((a) => a.path ?? a.name),
              });
    };
    walk(report);
    return text(failures.slice(0, 50));
  },
);

server.registerTool(
  'list_etl_rules',
  { description: 'List data-quality rule files and mapping specs for ETL tests.', inputSchema: {} },
  async () => {
    const rulesDir = join(ROOT, 'config', 'etl', 'rules');
    const mapDir = join(ROOT, 'config', 'etl', 'mappings');
    return text({
      rules: existsSync(rulesDir) ? readdirSync(rulesDir).map((f) => ({ file: f, content: readFileSync(join(rulesDir, f), 'utf8') })) : [],
      mappings: existsSync(mapDir) ? readdirSync(mapDir) : [],
    });
  },
);

server.registerTool(
  'get_etl_mapping',
  { description: 'Return a source-to-target mapping spec (markdown).', inputSchema: { name: z.string() } },
  async ({ name }) => {
    const file = join(ROOT, 'config', 'etl', 'mappings', name.endsWith('.md') ? name : `${name}.md`);
    return text(existsSync(file) ? readFileSync(file, 'utf8') : `No mapping '${name}'`);
  },
);

server.registerResource(
  'coding-standards',
  'qa://standards',
  { title: 'Test coding standards', mimeType: 'text/markdown' },
  async (uri) => ({
    contents: [{ uri: uri.href, text: readFileSync(join(ROOT, 'docs', 'CODING_STANDARDS.md'), 'utf8') }],
  }),
);

await server.connect(new StdioServerTransport());
