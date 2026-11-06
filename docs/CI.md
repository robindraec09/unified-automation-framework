# CI plan: GitHub Actions

Workflow: `.github/workflows/tests.yml`. One pipeline, staged rollout, so the first push goes green with no secrets.

## What runs when

| Trigger               | Static           | API                         | Web                                   | ETL      | Bank (Docker) | Mobile     |
| --------------------- | ---------------- | --------------------------- | ------------------------------------- | -------- | ------------- | ---------- |
| Pull request          | typecheck + lint | `@smoke`                    | Chromium `@smoke`, 2 shards           | `@smoke` | `@smoke`      | off        |
| Push to main          | yes              | full                        | Chromium full                         | full     | full          | if enabled |
| Nightly (14:00 UTC)   | yes              | full                        | Chromium, Firefox, WebKit, mobile-web | full     | full          | if enabled |
| Manual (Run workflow) | yes              | env + tag filter you choose | Chromium                              | yes      | yes           | if enabled |

Every job uploads a blob report; the `report` job merges them (`merge.config.ts`) into the engineers' HTML report
(artifact `html-report`) and the one-page stakeholder report; both are in the `quality-report` artifact, and the
stakeholder summary is posted on the run page. Trend history is kept per branch in the Actions cache.

## Rollout

**Stage 1: first push (no setup needed)**

- Demo targets (saucedemo, jsonplaceholder, local Docker Postgres) and demo credentials in `config/env/dev.json`.
- Harbourline Bank (`apps/bank`) runs in Docker inside the job: PostgreSQL 17, seed, app. No secrets; on failure the job prints the container logs.
- After the first local `pnpm install`, commit `pnpm-lock.yaml` and switch `pnpm install` to `pnpm install --frozen-lockfile` in the workflow.

**Stage 2: your applications**

- Add `config/env/qa.json` (and others) pointing at your apps; set repo variable `TEST_ENV=qa`.
- Repository secrets (Settings → Secrets and variables → Actions): `WEB_USER`, `WEB_PASSWORD`, `API_TOKEN`.
- ETL against real systems: `ETL_SOURCE_URL`, `ETL_TARGET_URL` as secrets (read-only roles), `ETL_PIPELINE=airflow`
  plus `AIRFLOW_URL` / `AIRFLOW_TOKEN`; the job then needs network access to those systems (self-hosted runner or VPN).

**Stage 3: mobile**

- Variables: `MOBILE_ENABLED=true`, `CLOUD=browserstack`, `DEVICE=pixel-8`. Secrets: `CLOUD_USER`, `CLOUD_KEY`.
- Upload the app build to the device cloud and set its id in `config/devices/pixel-8.json`.

**Stage 4: gates and reporting**

- Branch protection on `main`: require `Typecheck and lint`, `API`, `Web (shard 1/2)`, `Web (shard 2/2)`, `ETL`, `Bank (Docker)`.
- Publish the HTML/Allure report to GitHub Pages; post nightly failures to Slack or Teams.
- Post-deploy smoke: call this workflow (`workflow_dispatch` with `grep=@smoke`) from the deployment pipeline.
- Agents: PRs from agents carry the `ai-generated` label and pass the same required checks.

## Secrets and variables

| Name                                                               | Kind     | Stage | Used by                      |
| ------------------------------------------------------------------ | -------- | ----- | ---------------------------- |
| `TEST_ENV`                                                         | variable | 2     | all jobs (defaults to `dev`) |
| `WEB_USER`, `WEB_PASSWORD`                                         | secret   | 2     | web setup project            |
| `API_TOKEN`                                                        | secret   | 2     | API clients                  |
| `ETL_SOURCE_URL`, `ETL_TARGET_URL`, `AIRFLOW_URL`, `AIRFLOW_TOKEN` | secret   | 2     | ETL job                      |
| `MOBILE_ENABLED`, `CLOUD`, `DEVICE`                                | variable | 3     | mobile job                   |
| `CLOUD_USER`, `CLOUD_KEY`                                          | secret   | 3     | mobile job                   |
