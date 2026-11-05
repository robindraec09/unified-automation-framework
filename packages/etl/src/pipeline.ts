import { logger, type FrameworkConfig } from '@qa/core';
import type { DbClient } from './db';
import { localJobs } from './jobs';

const log = logger('pipeline');

export interface PipelineRunResult {
  job: string;
  runId: string;
  state: 'success' | 'failed';
  durationMs: number;
}

export interface PipelineRunner {
  run(job: string, params: Record<string, string>): Promise<PipelineRunResult>;
}

/** Runs demo jobs in-process against the local Docker databases. */
export class LocalPipeline implements PipelineRunner {
  constructor(
    private source: DbClient,
    private target: DbClient,
  ) {}

  async run(job: string, params: Record<string, string>) {
    const fn = localJobs[job];
    if (!fn) throw new Error(`Unknown local job ${job}`);
    const start = Date.now();
    await fn(this.source, this.target, params);
    return { job, runId: `local-${start}`, state: 'success' as const, durationMs: Date.now() - start };
  }
}

/** Triggers an Airflow DAG through its REST API and polls until it finishes. */
export class AirflowPipeline implements PipelineRunner {
  constructor(
    private baseUrl: string,
    private token: string,
    private timeoutMs = 10 * 60_000,
  ) {}

  private async call(path: string, init?: RequestInit) {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) throw new Error(`Airflow ${path} -> ${res.status} ${await res.text()}`);
    return res.json();
  }

  async run(job: string, params: Record<string, string>) {
    const start = Date.now();
    const created = await this.call(`/dags/${job}/dagRuns`, { method: 'POST', body: JSON.stringify({ conf: params }) });
    const runId: string = created.dag_run_id;
    log.info('dag run started', { job, runId });

    while (Date.now() - start < this.timeoutMs) {
      const run = await this.call(`/dags/${job}/dagRuns/${encodeURIComponent(runId)}`);
      if (run.state === 'success' || run.state === 'failed') {
        return { job, runId, state: run.state, durationMs: Date.now() - start } as PipelineRunResult;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    throw new Error(`DAG ${job} run ${runId} did not finish in ${this.timeoutMs} ms`);
  }
}

export function createPipeline(cfg: FrameworkConfig, source: DbClient, target: DbClient): PipelineRunner {
  switch (cfg.etl.pipeline) {
    case 'local':
      return new LocalPipeline(source, target);
    case 'airflow':
      return new AirflowPipeline(cfg.etl.orchestratorUrl ?? '', cfg.etl.orchestratorToken ?? '');
    default:
      throw new Error(`Pipeline adapter '${cfg.etl.pipeline}' not implemented yet (adf, glue, dbt-cloud)`);
  }
}
