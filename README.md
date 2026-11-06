# Unified Automation Framework

A unified test automation framework: **web, mobile, API and data/ETL** on one runner (Playwright Test),
a **local banking app** to test against, **Docker** for the whole stack, a **one-page stakeholder report**
on every run, and **MCP servers and AI agents** that plan, generate and heal tests in this framework's own style.

How it fits together, with diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contents

- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Layout](#layout)
- [Writing a test](#writing-a-test)
- [Configuration](#configuration)
- [Reporting](#reporting)
- [Channels](#channels)
- [Agents and MCP](#agents-and-mcp)
- [CI](#ci)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Next steps](#next-steps)

## Prerequisites

| For                     | You need                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Everything in Docker    | Docker Desktop (or Docker Engine with Compose v2)                                                          |
| Running on your machine | Node.js 20+ and pnpm 10. pnpm comes with Node through Corepack: run `corepack enable` once (Node 20 to 24) |
| Native mobile           | Appium 2 plus an emulator, simulator or device cloud account                                               |

Commands below use `pnpm`. Without it on your PATH, prefix with `corepack` (`corepack pnpm test:api`) or use
the plain Docker commands.

## Quick start

### Everything in Docker (recommended)

Systems under test and the test runner (Playwright + browsers) all run in containers:

```bash
pnpm stack:up      # ETL databases, Harbourline Bank (PostgreSQL 17 + app); waits until healthy
pnpm stack:test    # runs api, web-chromium, etl, bank-api, bank-web in the `tests` container
pnpm stack:down    # stop everything and delete the data
```

Without pnpm: `docker compose up -d --build --wait`, then `docker compose run --rm --build tests`.
Pick suites or tags as you would locally: `docker compose run --rm tests --project=bank-api --grep @smoke`.
Reports land in `./build/reports` on your machine (`pnpm report:stakeholder`, `pnpm report`).

| Service                     | Purpose                                                                    | Host port  |
| --------------------------- | -------------------------------------------------------------------------- | ---------- |
| `source-db`, `warehouse-db` | ETL demo databases (PostgreSQL 16)                                         | 5433, 5434 |
| `bank-db`                   | Harbourline Bank database (PostgreSQL 17)                                  | 5435       |
| `bank-init`                 | Seeds the bank database on first start, then exits                         | none       |
| `bank-app`                  | Harbourline Bank UI + API: <http://localhost:4000>                         | 4000       |
| `tests`                     | The framework + Playwright browsers; runs on demand (`docker compose run`) | none       |

Defined in [compose.yaml](compose.yaml), which includes `docker/etl` and `docker/bank`.

### On your machine

```bash
corepack enable                          # once, provides pnpm
pnpm install
pnpm exec playwright install --with-deps
cp .env.example .env

pnpm test:api                            # demo API (jsonplaceholder)
pnpm test:web                            # demo web shop (saucedemo); runs its login setup first
pnpm etl:up && pnpm test:etl             # ETL demo against Docker PostgreSQL
pnpm bank:up && pnpm test:bank           # Harbourline Bank in Docker
pnpm report:stakeholder                  # one-page summary;  pnpm report for engineering detail
```

The demo targets are public apps or local containers, so everything runs on day one. To test your own
systems, see [Extending the framework](docs/ARCHITECTURE.md#11-extending-the-framework).

## Layout

```
packages/
  core/        config loader (Zod-validated), logger, BUILD output paths, AUTH session files
  data/        builders (PostBuilder, OrderBuilder, PayeeBuilder), cleanup registry
  web/         page + component objects (saucedemo, Harbourline), web fixtures (shop, bank, a11y)
  mobile/      Appium session fixture (WebdriverIO), screen objects, capabilities
  api/         service clients, OAuth client, Zod schemas, toMatchSchema matcher, bank fixtures
  etl/         DB clients, pipeline runners (local, Airflow), reconciliation, YAML rule engine, bankDb
  flows/       business flows shared across channels
  test/        the single entry point: import { test, expect } from '@qa/test'
  reporting/   stakeholder reporter (one-page HTML + Markdown summary + trend history)
  mcp-server/  framework MCP server for agents
apps/bank/     Harbourline Bank: local system under test (UI + API with Basic/OAuth 2.0 + PostgreSQL)
tests/         setup/, web/, api/, mobile/, etl/, bank/
config/        env/*.json, devices/*.json, etl/rules/*.yml, etl/mappings/*.md
docker/        etl/ and bank/ compose files, tests/ (test runner image)
compose.yaml   the whole stack: systems under test + test runner
merge.config.ts  merges CI shard results into the reports
docs/          ARCHITECTURE.md, CI.md, CODING_STANDARDS.md
seed/          seed spec for the planner agent
specs/         Markdown test plans (planner output)
build/         everything a run generates (git-ignored), see Reporting
.mcp.json      Playwright MCP, Appium MCP, framework MCP, data MCP
```

## Writing a test

Specs import fixtures only from `@qa/test` and work through page objects, clients and builders, never raw
locators or driver calls. Tag each test by the risk it covers.

```ts
import { test, expect } from '@qa/test';
import { toAud } from '@qa/web';

test.use({ storageState: { cookies: [], origins: [] } }); // start logged out

test('transfer between own accounts updates both balances @smoke', async ({ bank, bankCustomer }) => {
  // bankCustomer: a fresh customer (Everyday $1,000, Saver $5,000), deleted after the test
  await bank.login.loginAs(bankCustomer.username, bankCustomer.password);
  await bank.transfer.open();
  await bank.transfer.transferBetween('Everyday Account', 'Saver Account', '100');

  await bank.accounts.open();
  await expect(bank.accounts.balanceOf('Everyday Account')).toHaveText(toAud(900));
});
```

| Fixture                                                                | What you get                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `config`, `cleanup`                                                    | Typed config; a registry that undoes what the test created, even on failure |
| `shop`, `bank`, `a11y`                                                 | Web page objects; an axe accessibility scan                                 |
| `posts`, `bankApi`, `bankApiAs({ basic \| bearer \| oauth })`, `oauth` | API clients, authenticated as asked                                         |
| `bankCustomer`, `bankSupport`                                          | Isolated test data in the bank (created and deleted per test)               |
| `source`, `warehouse`, `pipeline`, `bankDb`                            | Database clients and the ETL pipeline runner                                |
| `app` (mobile)                                                         | Screen objects on a worker-scoped Appium session                            |

Rules for locators, waits, assertions, tags and agent changes: [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md).

## Configuration

- `TEST_ENV` picks `config/env/<name>.json` (default `dev`). Environment variables override file values;
  empty ones are ignored, so unset CI secrets fall back to the file.
- Put local overrides and secrets in `.env` (git-ignored, never copied into images). `.env.example` lists them.
- Harbourline Bank has local defaults for everything (base URL, DB URL, OAuth clients); override with `BANK_*` variables.

Details and precedence: [docs/ARCHITECTURE.md#9-configuration-and-secrets](docs/ARCHITECTURE.md#9-configuration-and-secrets).

## Reporting

Every run writes two reports:

| Report                                 | For                                         | Open with                                   | What it shows                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/reports/stakeholder/index.html` | Product owners, managers, release decisions | `pnpm report:stakeholder`, or open the file | Release status (Ready / At risk / Not ready), pass rate and change since the last run, results by product area and by quality dimension (critical journeys, security, data integrity, ...), pass-rate trend, failures and flaky tests in plain language |
| `build/reports/playwright/index.html`  | Engineers                                   | `pnpm report`                               | Every test step, errors, screenshots, videos, traces                                                                                                                                                                                                    |

The stakeholder report is one self-contained HTML file: no internet needed, safe to email or attach,
prints cleanly to PDF, light and dark themes, keyboard and screen-reader accessible (checked with axe).
It also writes `summary.md` (for chat, email or the CI job summary), `summary.json`, and `history.json`,
which keeps the last 30 runs for the trend chart. Built by the custom reporter in `packages/reporting`.
Open the file directly (not through `pnpm report:stakeholder`) to follow its link to the engineering report.

**Release status rules:** _Not ready_ if any `@smoke` or `@security` test fails or the pass rate is below 90%;
_At risk_ if anything else fails or is flaky; otherwise _Ready to release_. Product areas come from the
Playwright projects (names in `packages/reporting/src/stakeholder-reporter.ts`), quality dimensions from
test tags (`packages/reporting/src/model.ts`); adjust both to your organisation's language.

### Where generated files go

Everything a run produces is under `build/` (git-ignored; paths defined once as `BUILD` in `packages/core`):

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

| Project                                       | Driver                                                            | Typical tags                             |
| --------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `api`                                         | Playwright APIRequestContext                                      | `@smoke @contract @functional @negative` |
| `web-chromium` / `web-firefox` / `web-webkit` | Playwright                                                        | `@smoke @regression @a11y`               |
| `mobile-web`                                  | Playwright device emulation                                       | `@smoke`                                 |
| `android` / `ios`                             | Appium via WebdriverIO                                            | `@smoke @device`                         |
| `etl`                                         | DB + pipeline fixtures                                            | `@etl @recon @dq`                        |
| `bank-api` / `bank-web`                       | Harbourline Bank (running container, or auto-started on the host) | `@smoke @security @negative @db @a11y`   |

### Harbourline Bank (local system under test)

A fictional bank in `apps/bank` that you run locally: internet-banking UI, REST API with HTTP Basic and
OAuth 2.0 (password, client credentials, authorization code + PKCE, rotating refresh tokens), and PostgreSQL.
It exercises every layer of the framework against one realistic system.

1. `pnpm bank:up` (or `pnpm stack:up` for everything) starts it in Docker: PostgreSQL 17 (port 5435), a seed job and the app (port 4000).
2. `pnpm test:bank`. Uses the running app, or starts one on the host if port 4000 is free. Tests skip with a reason if the bank is down (CI fails instead).
3. Open <http://localhost:4000> and log in as `alex.morgan` / `Harbour#2026`.
   `pnpm bank:reset` reloads the seed data; `pnpm bank:down` stops it but keeps the data; `pnpm stack:down` deletes it.

Prefer your own PostgreSQL install? Set `BANK_DB_URL` and `BANK_DB_ADMIN_URL` in `.env` and run `pnpm bank:db:init`.
API, seed data and OAuth clients: [apps/bank/README.md](apps/bank/README.md).

### Mobile

1. Install Appium 2+ and drivers: `npm i -g appium && appium driver install uiautomator2` (and `xcuitest` on macOS).
2. Put your app build in `mobile-builds/` (git-ignored; e.g. `mobile-builds/android/app-debug.apk`) or upload it
   to your device cloud; adjust `config/devices/*.json`.
3. `appium` in one terminal, then `MOBILE_ENABLED=1 pnpm test:mobile:android`.
4. Device cloud: set `CLOUD=browserstack`, `DEVICE=pixel-8`, `CLOUD_USER`, `CLOUD_KEY`.

### ETL

- `orders.recon.spec.ts` seeds source rows for a unique run date, runs the `orders_daily` job,
  then compares counts, totals and row hashes (mapping applied on the source side). Mismatches are attached as CSV.
- `dq.rules.spec.ts` generates one test per rule in `config/etl/rules/*.yml`.
- Real pipelines: set `ETL_PIPELINE=airflow` with `AIRFLOW_URL`/`AIRFLOW_TOKEN`; add adapters for ADF, Glue or dbt Cloud in
  `packages/etl/src/pipeline.ts`, and DB adapters (SQL Server, Oracle, Snowflake, BigQuery, Databricks) in `db.ts`.
- Heavy volumes: keep comparisons in SQL; partition by date and bucket hashes before pulling rows.

## Agents and MCP

```bash
pnpm agents:init        # playwright init-agents --loop=claude  (or vscode / copilot / opencode)
```

This adds Playwright's planner, generator and healer agents. Re-run after every Playwright upgrade.
`.mcp.json` registers:

| Server         | Purpose                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `playwright`   | Browser control for planner/generator/healer                                                                                 |
| `appium`       | Device control for mobile agents (`appium-mcp`)                                                                              |
| `qa-framework` | This repo's page objects, fixtures, configs, ETL rules and standards; run tests (any project, incl. `bank-*`); read failures |
| `data`         | Read-only SQL and schema discovery (MCP Toolbox for Databases). Use a read-only DB role.                                     |

Custom agents live in `.claude/agents/` (e.g. `etl-test-generator.md`). Point the generator at
`list_page_objects` and `qa://standards` so it uses our objects instead of raw locators.

**Guardrails:** agents work on branches and open PRs labelled `ai-generated`; `run_tests` refuses production;
the healer may change locators and waits only. See [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md).

## CI

GitHub Actions, `.github/workflows/tests.yml`: typecheck and lint → API, sharded web, ETL, Harbourline Bank
(in Docker) and mobile on a device cloud once enabled → one merged report job. Pull requests run `@smoke`;
pushes to `main` and the nightly run do everything.

The report job posts the stakeholder summary on the run page and uploads the `quality-report` artifact
(stakeholder page + engineering report; open `stakeholder/index.html`). Trend history is kept per branch.
It runs green with no secrets; the staged rollout (secrets, variables, branch protection) is in [docs/CI.md](docs/CI.md).

## Troubleshooting

| Symptom                                                    | Fix                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                                  | `corepack enable`, or prefix commands with `corepack`                                                                                  |
| Every bank or ETL test is skipped                          | The system is down: `pnpm stack:up` (or `bank:up` / `etl:up`). The skip reason in the report says which                                |
| Docker commands fail with "cannot find the file specified" | Start Docker Desktop                                                                                                                   |
| Port 4000 or 5433-5435 already in use                      | Stop the other process, or another copy of the stack (`pnpm stack:down`)                                                               |
| Bank tests fail at login as `alex.morgan`                  | Three wrong passwords lock a customer, so tests should never use `alex.morgan` for wrong-password cases. Unlock with `pnpm bank:reset` |
| `prettier --check` flags many files on Windows             | `core.autocrlf=true` gives CRLF working copies; the committed files are LF. CI does not run Prettier                                   |

## Documentation

| Document                                             | What's in it                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | Diagrams and design: packages, execution model, Docker stack, bank, reporting, CI, agents, decisions, extension points |
| [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | How tests are written (served to agents as `qa://standards`)                                                           |
| [docs/CI.md](docs/CI.md)                             | Pipeline triggers and the staged rollout                                                                               |
| [apps/bank/README.md](apps/bank/README.md)           | Harbourline Bank: running it, seed data, API, OAuth, database                                                          |
| [specs/README.md](specs/README.md)                   | Test plans from the planner agent                                                                                      |

## Next steps

- Point the framework at your own applications: [Extending the framework](docs/ARCHITECTURE.md#11-extending-the-framework).
- Agree the `data-testid` contract with dev teams and set `testIdAttribute` in `playwright.config.ts`
  (Harbourline already follows it).
- Decide the device cloud and the approved agent client, then enable CI stages 2 to 4 ([docs/CI.md](docs/CI.md)).
