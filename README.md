# Unified Automation Framework

A unified test automation framework: **web, mobile, API and ETL** on one runner (Playwright Test),
with **MCP servers and AI agents** that plan, generate and heal tests in this framework's own style.

Architecture plan: see the shared doc *Unified Test Automation Framework — Architecture Plan*.

## Layout

```
packages/
  core/        config loader (Zod-validated), logger, auth-state paths
  data/        builders (PostBuilder, OrderBuilder), cleanup registry
  web/         page + component objects, web fixtures (shop, a11y)
  mobile/      Appium session fixture (WebdriverIO), screen objects, capabilities
  api/         service clients, Zod schemas, toMatchSchema matcher
  etl/         DB clients, pipeline runners (local, Airflow), reconciliation, YAML rule engine
  flows/       business flows shared across channels
  test/        the single entry point: import { test, expect } from '@qa/test'
  mcp-server/  framework MCP server for agents
apps/bank/     Harbourline Bank: local system under test (UI + API with Basic/OAuth 2.0 + Postgres)
tests/         setup/, web/, api/, mobile/, etl/, bank/
config/        env/*.json, devices/*.json, etl/rules/*.yml, etl/mappings/*.md
docker/etl/    local source + warehouse Postgres for the ETL demo
docker/bank/   Harbourline Bank containers: PostgreSQL 17, seed job, app
seed/          seed spec for the planner agent
specs/         Markdown test plans (planner output)
.mcp.json      Playwright MCP, Appium MCP, framework MCP, data MCP
```

## Quick start

### Everything in Docker (recommended)

Needs only Docker. Systems under test and the test runner (Playwright + browsers) all run in containers:

```bash
pnpm stack:up      # ETL databases, Harbourline Bank (PostgreSQL 17 + app); waits until healthy
pnpm stack:test    # runs api, web-chromium, etl, bank-api, bank-web in the `tests` container
pnpm stack:down    # stop everything, delete the data
```

No pnpm on your machine? Use Docker directly: `docker compose up -d --build --wait`, then
`docker compose run --rm --build tests`. Pick suites or tags the same way as locally:
`docker compose run --rm tests --project=bank-api --grep @smoke`. The HTML report is written to
`./build/reports` on your machine (`pnpm report:stakeholder` and `pnpm report` open them). Native mobile is not containerised.

| Service | Purpose | Host port |
| --- | --- | --- |
| `source-db`, `warehouse-db` | ETL demo databases (PostgreSQL 16) | 5433, 5434 |
| `bank-db` | Harbourline Bank database (PostgreSQL 17) | 5435 |
| `bank-init` | seeds the bank DB on first start, then exits | none |
| `bank-app` | Harbourline Bank UI + API | 4000 |
| `tests` | the framework + Playwright browsers; runs on demand (`docker compose run`) | none |

Defined in [compose.yaml](compose.yaml), which includes `docker/etl` and `docker/bank`.

### On your machine

```bash
pnpm install
pnpm exec playwright install --with-deps
cp .env.example .env

pnpm test:api            # demo API (jsonplaceholder)
pnpm test:web            # demo web app (saucedemo), runs the setup project first
pnpm etl:up && pnpm test:etl   # ETL demo against local Docker Postgres
pnpm report
pnpm bank:up && pnpm test:bank   # Harbourline Bank in Docker (see below)
```

The sample targets are public demo apps so everything runs on day one. Replace them with your systems:
point `config/env/*.json` at your URLs and swap the example page objects, clients and mappings.

## Reporting

Every run writes two reports:

| Report | For | Open with | What it shows |
| --- | --- | --- | --- |
| `build/reports/stakeholder/index.html` | Product owners, managers, release decisions | `pnpm report:stakeholder` or open the file | Release status (Ready / At risk / Not ready), pass rate and change since the last run, results by product area and by quality dimension (critical journeys, security, data integrity, ...), pass-rate trend, failures and flaky tests in plain language |
| `build/reports/playwright/index.html` | Engineers | `pnpm report` | Every test step, errors, screenshots, videos, traces |

The stakeholder report is one self-contained HTML file: no internet needed, safe to email or attach,
prints cleanly to PDF, light and dark themes, and keyboard and screen-reader accessible (checked with axe).
It also writes `summary.md` (for chat, email or the CI job summary), `summary.json`, and `history.json`,
which keeps the last 30 runs for the trend chart. Built by the custom reporter in `packages/reporting`.

**Release status rules:** *Not ready* if any `@smoke` or `@security` test fails or the pass rate is below 90%;
*At risk* if anything else fails or is flaky; otherwise *Ready to release*. Product areas come from the
Playwright projects (names in `packages/reporting/src/stakeholder-reporter.ts`), quality dimensions from
test tags (`packages/reporting/src/model.ts`); adjust both to your organisation's language.

**In CI** the report job merges all shards (`merge.config.ts`), keeps the trend history per branch in the
Actions cache, posts the summary on the run page, and uploads both reports as the `quality-report` artifact.

### Where generated files go

Everything a run produces is under `build/` (git-ignored; paths defined once in `BUILD`, `packages/core`):

```
build/
  reports/
    stakeholder/      one-page report, summary.md, summary.json, history.json (trend)
    playwright/       engineers' HTML report
    allure-results/   raw Allure results (CI)
    blob/             shard blob reports (CI), merged by the report job
    mcp/              last run of the qa-framework MCP server's run_tests tool
  test-results/       screenshots, videos, traces and attachments (cleared at the start of each run)
  auth/               saved login sessions from the setup projects
```

`pnpm clean` deletes `build/`, including the trend history. The Docker test runner writes to the same folder.

## Channels

| Project | Driver | Typical tags |
| --- | --- | --- |
| `api` | Playwright APIRequestContext | `@smoke @contract @functional @negative` |
| `web-chromium` / `web-firefox` / `web-webkit` | Playwright | `@smoke @regression @a11y` |
| `mobile-web` | Playwright device emulation | `@smoke` |
| `android` / `ios` | Appium via WebdriverIO | `@smoke @device` |
| `etl` | DB + pipeline fixtures | `@etl @recon @dq` |
| `bank-api` / `bank-web` | Local Harbourline Bank (auto-started) | `@smoke @security @negative @db @a11y` |

### Mobile
1. Install Appium 2+ and drivers: `npm i -g appium && appium driver install uiautomator2` (and `xcuitest` on macOS).
2. Put your build in `apps/` or upload it to your device cloud; adjust `config/devices/*.json`.
3. `appium` in one terminal, then `MOBILE_ENABLED=1 pnpm test:mobile:android`.
4. Device cloud: set `CLOUD=browserstack`, `DEVICE=pixel-8`, `CLOUD_USER`, `CLOUD_KEY`.

### Harbourline Bank (local system under test)
A fictional bank in `apps/bank` that you run locally: internet-banking UI, REST API with HTTP Basic and
OAuth 2.0 (password, client credentials, authorization code + PKCE, rotating refresh tokens), and PostgreSQL.
It exercises every layer of the framework against one realistic system.

1. `pnpm bank:up` (or `pnpm stack:up` for everything) starts it in Docker: PostgreSQL 17 (port 5435), a seed job and the app (port 4000).
2. `pnpm test:bank`. Uses the running app, or starts it on the host if port 4000 is free; tests skip cleanly if the DB is down.
3. Open <http://localhost:4000> (`alex.morgan` / `Harbour#2026`). `pnpm bank:reset` reloads the seed, `pnpm bank:down` stops it (data kept; `pnpm stack:down` deletes it).

Prefer your own PostgreSQL install? Set `BANK_DB_URL` and `BANK_DB_ADMIN_URL` in `.env` and run `pnpm bank:db:init`.

Fixtures: `bank` (page objects), `bankApi` / `bankApiAs({ basic | bearer | oauth })`, `oauth`,
`bankCustomer` (a fresh customer per test, deleted afterwards) and `bankDb`. Details: [apps/bank/README.md](apps/bank/README.md).

### ETL
- `orders.recon.spec.ts` seeds source rows for a unique run date, runs the `orders_daily` job,
  then compares counts, totals and row hashes (mapping applied on the source side). Mismatches are attached as CSV.
- `dq.rules.spec.ts` generates one test per rule in `config/etl/rules/*.yml`.
- Real pipelines: set `ETL_PIPELINE=airflow` with `AIRFLOW_URL`/`AIRFLOW_TOKEN`; add adapters for ADF, Glue or dbt Cloud in
  `packages/etl/src/pipeline.ts`, and DB adapters (SQL Server, Oracle, Snowflake, BigQuery, Databricks) in `db.ts`.
- Heavy volumes: keep comparisons in SQL; partition by date and bucket hashes before pulling rows.

## Agents and MCP

```bash
pnpm agents:init        # npx playwright init-agents --loop=claude  (or vscode / copilot / opencode)
```

This adds Playwright's planner, generator and healer agents. Re-run after every Playwright upgrade.
`.mcp.json` registers:

| Server | Purpose |
| --- | --- |
| `playwright` | Browser control for planner/generator/healer |
| `appium` | Device control for mobile agents (`appium-mcp`) |
| `qa-framework` | This repo's page objects, fixtures, configs, ETL rules; run tests; read failures |
| `data` | Read-only SQL and schema discovery (MCP Toolbox for Databases). Use a read-only DB role. |

Custom agents live in `.claude/agents/` (e.g. `etl-test-generator.md`). Point the generator at
`list_page_objects` and `qa://standards` so it uses our objects instead of raw locators.

**Guardrails:** agents work on branches and open PRs labelled `ai-generated`; `run_tests` refuses production;
the healer may change locators and waits only. See `docs/CODING_STANDARDS.md`.

## CI

GitHub Actions, `.github/workflows/tests.yml`: static checks → API, sharded web, ETL, and mobile on a device
cloud once enabled → one merged HTML report. It runs green on the first push with no secrets; the staged
rollout (secrets, variables, branch protection, reporting) is in [docs/CI.md](docs/CI.md).

## Next steps
- Replace demo targets with your applications and services.
- Agree the `data-testid` contract with dev teams and set `testIdAttribute` in `playwright.config.ts`.
- Decide device cloud, CI platform and approved agent client (see open decisions in the plan).
