import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';
import {
  DIMENSIONS,
  add,
  emptyCounts,
  passRate,
  releaseStatus,
  type GroupRow,
  type HistoryEntry,
  type Outcome,
  type RunModel,
  type TestRow,
} from './model';
import { renderHtml, renderMarkdown } from './render';

export interface StakeholderReporterOptions {
  /** Folder for index.html, summary.md, summary.json and history.json. Default: build/reports/stakeholder */
  outputFolder?: string;
  title?: string;
  /** Friendly names for Playwright projects, e.g. { 'bank-api': 'Banking API' } */
  areas?: Record<string, string>;
  /** Runs kept for the trend chart. Default 30 */
  historySize?: number;
  /** Where the Playwright HTML report lives, to link failures to detail. Default: build/reports/playwright */
  detailReportFolder?: string;
}

const DEFAULT_AREAS: Record<string, string> = {
  api: 'Public API (demo)',
  'web-chromium': 'Web shop · Chrome',
  'web-firefox': 'Web shop · Firefox',
  'web-webkit': 'Web shop · Safari',
  'mobile-web': 'Mobile web',
  etl: 'Data pipeline (ETL)',
  'bank-api': 'Banking API',
  'bank-web': 'Internet banking',
  'bank-android': 'Harbourline Mobile (Android)',
  android: 'Android app',
  ios: 'iOS app',
};

const isSetup = (project: string) => /(^|-)setup$/.test(project);
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

function summariseError(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const lines = stripAnsi(message)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const text = lines.slice(0, 3).join(' · ');
  return text.length > 320 ? `${text.slice(0, 317)}...` : text;
}

function git(cmd: string): string | undefined {
  try {
    return (
      execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Playwright reporter that writes a one-page, self-contained HTML report for stakeholders:
 * release status, pass rate, results by business area and quality dimension, trend, failures.
 * Works for normal runs and for `playwright merge-reports` (CI shards).
 */
export default class StakeholderReporter implements Reporter {
  private root!: Suite;
  private config!: FullConfig;
  private startedAt = new Date();
  private readonly out: string;
  private readonly options: StakeholderReporterOptions;

  constructor(options: StakeholderReporterOptions = {}) {
    this.options = options;
    this.out = resolve(options.outputFolder ?? 'build/reports/stakeholder');
  }

  printsToStdio() {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.root = suite;
    this.startedAt = new Date();
  }

  async onEnd(result: FullResult) {
    const model = this.buildModel(result);
    mkdirSync(this.out, { recursive: true });

    const historyFile = join(this.out, 'history.json');
    let history: HistoryEntry[] = [];
    try {
      if (existsSync(historyFile)) history = JSON.parse(readFileSync(historyFile, 'utf8'));
    } catch {
      history = [];
    }
    history = [
      ...history,
      {
        startedAt: model.startedAt,
        passRate: model.passRate,
        status: model.status,
        counts: model.counts,
        branch: model.info.branch,
        commit: model.info.commit,
      },
    ].slice(-(this.options.historySize ?? 30));

    writeFileSync(historyFile, JSON.stringify(history, null, 2));
    writeFileSync(join(this.out, 'summary.json'), JSON.stringify(model, null, 2));
    writeFileSync(join(this.out, 'summary.md'), renderMarkdown(model));
    writeFileSync(join(this.out, 'index.html'), renderHtml(model, history));
    console.log(`\nStakeholder report: ${relative(process.cwd(), join(this.out, 'index.html'))}`);
  }

  private outcomeOf(test: TestCase): Outcome {
    const o = test.outcome();
    return o === 'expected' ? 'passed' : o === 'unexpected' ? 'failed' : o;
  }

  private buildModel(result: FullResult): RunModel {
    const areaNames = { ...DEFAULT_AREAS, ...this.options.areas };
    const rows: TestRow[] = this.root.allTests().map((test) => {
      const project = test.parent.project()?.name ?? 'default';
      const last = test.results[test.results.length - 1];
      const outcome = this.outcomeOf(test);
      const path = test
        .titlePath()
        .slice(3) // root, project, file
        .join(' › ')
        .replace(/\s@[\w-]+/g, '')
        .trim();
      return {
        title: test.title.replace(/\s@[\w-]+/g, '').trim(),
        path,
        project,
        area: isSetup(project) ? 'Test setup' : (areaNames[project] ?? project),
        location: `${relative(this.config.rootDir, test.location.file).replace(/\\/g, '/')}:${test.location.line}`,
        outcome,
        durationMs: test.results.reduce((s, r) => s + r.duration, 0),
        retries: Math.max(0, test.results.length - 1),
        tags: test.tags,
        error:
          outcome === 'failed' ? summariseError(last?.error?.message ?? last?.errors[0]?.message) : undefined,
        skipReason:
          outcome === 'skipped'
            ? (test.annotations.find((a) => a.type === 'skip')?.description ??
              last?.annotations.find((a) => a.type === 'skip')?.description ??
              'Not run (a dependency failed, or the test is disabled)')
            : undefined,
      };
    });

    // Setup projects only matter when they fail: they gate other tests but are not product coverage
    const counted = rows.filter((r) => !isSetup(r.project) || r.outcome === 'failed');
    const counts = emptyCounts();
    counted.forEach((r) => add(counts, r.outcome));

    const areaMap = new Map<string, GroupRow>();
    for (const r of counted.filter((x) => !isSetup(x.project))) {
      const row = areaMap.get(r.project) ?? { key: r.project, label: r.area, counts: emptyCounts() };
      add(row.counts, r.outcome);
      areaMap.set(r.project, row);
    }

    const dimensions = DIMENSIONS.map((d) => {
      const c = emptyCounts();
      counted.filter((r) => r.tags.some((t) => d.tags.includes(t))).forEach((r) => add(c, r.outcome));
      return { key: d.key, label: d.label, description: d.description, counts: c };
    }).filter((d) => d.counts.total > 0);

    const failures = counted.filter((r) => r.outcome === 'failed');
    const { status, reason } = releaseStatus(counts, failures);

    const reasons = new Map<string, number>();
    counted
      .filter((r) => r.outcome === 'skipped')
      .forEach((r) => reasons.set(r.skipReason!, (reasons.get(r.skipReason!) ?? 0) + 1));

    const detailFolder = resolve(this.options.detailReportFolder ?? 'build/reports/playwright');
    const env = process.env;
    return {
      title: this.options.title ?? 'Test results',
      startedAt: this.startedAt.toISOString(),
      durationMs: result.duration,
      counts,
      passRate: passRate(counts),
      status,
      statusReason: reason,
      areas: [...areaMap.values()],
      dimensions,
      failures,
      flaky: counted.filter((r) => r.outcome === 'flaky'),
      skippedReasons: [...reasons.entries()]
        .map(([r, count]) => ({ reason: r, count }))
        .sort((a, b) => b.count - a.count),
      tests: counted,
      info: {
        environment: env.TEST_ENV ?? 'dev',
        branch:
          env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.GIT_BRANCH || git('rev-parse --abbrev-ref HEAD'),
        commit: (env.GITHUB_SHA || env.GIT_COMMIT || git('rev-parse HEAD'))?.slice(0, 7),
        runner: env.GITHUB_ACTIONS
          ? 'GitHub Actions'
          : existsSync('/.dockerenv')
            ? 'Docker'
            : 'Local machine',
        playwright: this.config.version,
        workers: this.config.workers,
        ciUrl: env.GITHUB_RUN_ID
          ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
          : undefined,
      },
      detailReport: existsSync(detailFolder)
        ? relative(this.out, join(detailFolder, 'index.html')).replace(/\\/g, '/')
        : undefined,
    };
  }
}
