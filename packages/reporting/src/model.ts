/** Data model for the stakeholder report. Plain JSON: also written to summary.json and history.json. */

export type Outcome = 'passed' | 'failed' | 'flaky' | 'skipped';
export type ReleaseStatus = 'ready' | 'at-risk' | 'not-ready' | 'no-results';

export interface Counts {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  total: number;
}

export interface TestRow {
  title: string;
  /** describe blocks + title, without tags */
  path: string;
  project: string;
  area: string;
  location: string;
  outcome: Outcome;
  durationMs: number;
  retries: number;
  tags: string[];
  error?: string;
  skipReason?: string;
}

export interface GroupRow {
  key: string;
  label: string;
  description?: string;
  counts: Counts;
}

export interface RunInfo {
  environment: string;
  branch?: string;
  commit?: string;
  runner: string;
  playwright: string;
  workers: number;
  ciUrl?: string;
}

export interface RunModel {
  title: string;
  startedAt: string;
  durationMs: number;
  counts: Counts;
  /** (passed + flaky) / executed; null when nothing ran */
  passRate: number | null;
  status: ReleaseStatus;
  statusReason: string;
  areas: GroupRow[];
  dimensions: GroupRow[];
  failures: TestRow[];
  flaky: TestRow[];
  skippedReasons: { reason: string; count: number }[];
  tests: TestRow[];
  info: RunInfo;
  /** Relative link to the engineers' Playwright HTML report, if present */
  detailReport?: string;
}

export interface HistoryEntry {
  startedAt: string;
  passRate: number | null;
  status: ReleaseStatus;
  counts: Counts;
  branch?: string;
  commit?: string;
}

export const emptyCounts = (): Counts => ({ passed: 0, failed: 0, flaky: 0, skipped: 0, total: 0 });

export function add(c: Counts, o: Outcome) {
  c[o] += 1;
  c.total += 1;
}

export const passRate = (c: Counts) => {
  const executed = c.total - c.skipped;
  return executed > 0 ? (c.passed + c.flaky) / executed : null;
};

/** Quality dimensions stakeholders recognise, mapped from test tags. A test can count in several. */
export const DIMENSIONS: { key: string; label: string; description: string; tags: string[] }[] = [
  {
    key: 'smoke',
    label: 'Critical journeys',
    description: 'Smoke tests: what must always work',
    tags: ['@smoke'],
  },
  { key: 'security', label: 'Security', description: 'Sign-in, access control, tokens', tags: ['@security'] },
  {
    key: 'data',
    label: 'Data integrity',
    description: 'Ledgers, reconciliation, data-quality rules',
    tags: ['@db', '@dq', '@recon'],
  },
  {
    key: 'functional',
    label: 'Business rules',
    description: 'Features behave as specified',
    tags: ['@functional'],
  },
  {
    key: 'negative',
    label: 'Error handling',
    description: 'Bad input is refused safely',
    tags: ['@negative'],
  },
  {
    key: 'contract',
    label: 'API contracts',
    description: 'Responses match the agreed schema',
    tags: ['@contract'],
  },
  { key: 'a11y', label: 'Accessibility', description: 'WCAG 2 A/AA automated checks', tags: ['@a11y'] },
  {
    key: 'regression',
    label: 'Regression',
    description: 'Previously working behaviour',
    tags: ['@regression'],
  },
];

/** Failures here block a release outright. */
export const CRITICAL_TAGS = ['@smoke', '@security'];

export function releaseStatus(
  counts: Counts,
  failures: TestRow[],
): { status: ReleaseStatus; reason: string } {
  const rate = passRate(counts);
  const executed = counts.total - counts.skipped;
  const skippedNote = counts.skipped ? ` ${counts.skipped} skipped.` : '';
  if (rate === null) return { status: 'no-results', reason: `No tests ran.${skippedNote}` };

  const critical = failures.filter((f) => f.tags.some((t) => CRITICAL_TAGS.includes(t)));
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (critical.length || rate < 0.9) {
    const why = critical.length
      ? `${plural(critical.length, 'failure')} in critical journeys or security.`
      : `Pass rate is below 90%.`;
    return {
      status: 'not-ready',
      reason: `${why} ${plural(counts.failed, 'test')} failed in total.${skippedNote}`,
    };
  }
  if (counts.failed || counts.flaky) {
    const parts = [counts.failed && plural(counts.failed, 'failure'), counts.flaky && `${counts.flaky} flaky`]
      .filter(Boolean)
      .join(' and ');
    return { status: 'at-risk', reason: `${parts} outside critical journeys and security.${skippedNote}` };
  }
  return { status: 'ready', reason: `All ${executed} executed tests passed.${skippedNote}` };
}
