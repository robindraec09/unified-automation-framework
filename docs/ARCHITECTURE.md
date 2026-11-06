# Architecture

How the unified automation framework is put together: what talks to what, where code and data live,
how a test run flows from a command to a report, and where to extend it. Diagrams are Mermaid and render on GitHub.

- [1. System context](#1-system-context)
- [2. Package architecture](#2-package-architecture)
- [3. Test execution model](#3-test-execution-model)
- [4. Runtime: the Docker stack](#4-runtime-the-docker-stack)
- [5. Harbourline Bank (system under test)](#5-harbourline-bank-system-under-test)
- [6. Reporting](#6-reporting)
- [7. CI pipeline](#7-ci-pipeline)
- [8. Agents and MCP](#8-agents-and-mcp)
- [9. Configuration and secrets](#9-configuration-and-secrets)
- [10. Design decisions](#10-design-decisions)
- [11. Extending the framework](#11-extending-the-framework)
- [12. Known limitations](#12-known-limitations)

## 1. System context

One runner (Playwright Test) drives every channel: browsers, HTTP APIs, native mobile through Appium,
and databases. The systems under test are either public demo apps, local containers, or your own environments.

```mermaid
flowchart LR
  eng["QA engineers"]
  stake["Stakeholders<br/>product, release managers"]
  agents["AI agents<br/>planner, generator, healer"]

  subgraph fw["Unified automation framework"]
    runner["Playwright Test runner<br/>projects per channel"]
    reports["Reports<br/>stakeholder + engineering"]
    mcp["qa-framework MCP server"]
  end

  subgraph sut["Systems under test"]
    bank["Harbourline Bank<br/>local UI + API + PostgreSQL"]
    demo["Public demos<br/>saucedemo, jsonplaceholder"]
    etl["ETL source + warehouse<br/>PostgreSQL"]
    yours["Your environments<br/>config/env/*.json"]
  end

  devices["Appium / device cloud"]
  ci["GitHub Actions"]

  eng -->|"write and run tests"| runner
  agents -->|"MCP tools"| mcp
  mcp -->|"run_tests"| runner
  runner --> bank & demo & etl & yours
  runner -->|"WebdriverIO"| devices
  runner --> reports
  reports --> stake
  ci -->|"runs on every PR, push and nightly"| runner
```

## 2. Package architecture

A pnpm workspace. Specs get fixtures **only** from `@qa/test`; the channel packages hide drivers and locators
behind page objects, clients and fixtures. Arrows point from a package to what it imports. Specs also import
types, builders and schemas directly (e.g. `PayeeBuilder` from `@qa/data`, `TransferSchema` from `@qa/api`).

```mermaid
flowchart TB
  specs["tests/**/*.spec.ts"]
  test["@qa/test<br/>single entry: test, expect"]
  flows["@qa/flows<br/>cross-channel business flows"]

  subgraph channels["Channel packages"]
    web["@qa/web<br/>page + component objects, a11y"]
    api["@qa/api<br/>clients, Zod schemas, OAuth"]
    mobile["@qa/mobile<br/>Appium session, screens"]
    etl["@qa/etl<br/>DB clients, pipelines, rules"]
  end

  data["@qa/data<br/>builders, cleanup registry"]
  core["@qa/core<br/>config, logger, BUILD paths"]

  subgraph beside["Alongside: no imports from the framework"]
    reporting["@qa/reporting<br/>loaded by Playwright as a reporter"]
    mcpserver["@qa/mcp-server<br/>reads repo files, runs the CLI"]
    bankapp["apps/bank<br/>system under test"]
  end

  specs --> test
  test --> web & api & mobile & etl & data & core
  flows --> web & mobile
  api --> data & core
  data --> core
  mobile --> core
  etl --> core
```

| Package          | Responsibility                     | Key contents                                                                                                                           |
| ---------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@qa/core`       | Configuration and shared constants | Zod-validated config (`config/env/<TEST_ENV>.json` + env overrides), `logger`, `BUILD` output paths, `AUTH` session files              |
| `@qa/data`       | Test data                          | `PostBuilder`, `OrderBuilder`, `PayeeBuilder`; `CleanupRegistry` (LIFO teardown)                                                       |
| `@qa/web`        | Browser channel                    | `BasePage`, page objects (saucedemo, Harbourline), components, `a11y` (axe) fixture                                                    |
| `@qa/api`        | HTTP channel                       | `BaseClient`, service clients, `OAuthClient`, `BankTestSupport`, Zod contracts, `toMatchSchema` matcher, bank fixtures and health gate |
| `@qa/mobile`     | Native mobile                      | Worker-scoped WebdriverIO session, `BaseScreen`, platform-aware selectors, capabilities                                                |
| `@qa/etl`        | Data channel                       | `DbClient` (Postgres adapter), `LocalPipeline` / `AirflowPipeline`, hash reconciliation, YAML rule engine, `bankDb`                    |
| `@qa/flows`      | Business flows                     | One interface, one implementation per channel (e.g. login on web and mobile)                                                           |
| `@qa/test`       | Composition                        | `mergeTests` of every channel's fixtures + `config` and `cleanup`; `mergeExpects`                                                      |
| `@qa/reporting`  | Stakeholder report                 | Playwright `Reporter` building a run model, HTML/Markdown renderers, trend history                                                     |
| `@qa/mcp-server` | Agent interface                    | MCP tools over page objects, fixtures, configs, ETL rules, test runs                                                                   |

**Locator policy** (enforced in review and by ESLint): `getByRole` > `getByLabel` / `getByPlaceholder` >
`getByTestId` > CSS, never XPath; locators live in page objects, never in specs. See [CODING_STANDARDS.md](CODING_STANDARDS.md).

## 3. Test execution model

Every channel is a Playwright **project**. Setup projects log in once and save the session so the web
projects start authenticated.

```mermaid
flowchart LR
  setup["setup<br/>saucedemo login"] --> webc["web-chromium"] & webf["web-firefox"] & webw["web-webkit"] & mweb["mobile-web<br/>@smoke only"]
  bsetup["bank-setup<br/>Harbourline login"] --> bweb["bank-web"]
  api["api"]
  bapi["bank-api"]
  etl["etl<br/>serial, 15 min timeout"]
  android["android"]
  ios["ios"]
```

**Fixtures are lazy.** A spec gets only what it asks for: a web test never opens an Appium session or a
DB pool. Worker-scoped fixtures (DB pools, the Appium driver, the bank health check) are created once per worker.

```mermaid
flowchart TB
  subgraph merged["@qa/test = mergeTests(...)"]
    core["config, cleanup"]
    webf["shop, bank, a11y"]
    apif["posts, oauth, bankApi, bankApiAs,<br/>bankSupport, bankCustomer"]
    mobf["driver (worker), app"]
    etlf["source, warehouse, pipeline, bankDb<br/>pools are worker-scoped"]
    gate["bankGate (auto)<br/>skip, or fail when BANK_REQUIRED=1"]
  end
  spec["test('...', async ({ bank, bankCustomer, bankDb }) => ...)"] --> merged
```

**Data isolation.** Tests that change state create their own data and remove it afterwards, so the suite
runs fully parallel. Example: a Harbourline transfer test through the UI.

```mermaid
sequenceDiagram
  autonumber
  participant T as Spec
  participant F as Fixtures
  participant App as bank-app
  participant DB as bank-db
  T->>F: needs bankCustomer, bank, bankDb
  F->>App: POST /test-support/customers
  App->>DB: insert qa_* customer, 2 accounts
  F-->>T: username, password, accounts
  T->>App: log in and transfer via page objects
  App->>DB: one transaction: lock rows, debit, credit, ledger rows
  T->>DB: bankDb: transfer row matches the receipt
  T->>App: accounts page shows new balances
  F->>App: DELETE /test-support/customers/:id
  App->>DB: cascade delete
```

**Availability.** Bank and ETL fixtures skip a test with a reason when their system is down, so a laptop
without Docker still runs the rest. CI sets `BANK_REQUIRED=1`, which turns that skip into a failure:
a job can never pass with everything skipped.

## 4. Runtime: the Docker stack

`compose.yaml` (project `qa-stack`) includes `docker/etl` and `docker/bank` and adds the `tests` runner.
Containers talk by service name on the Compose network; host ports exist only for people and host-side runs.

```mermaid
flowchart LR
  subgraph host["Your machine"]
    browser["Browser"]
    hostrun["pnpm test:* on the host"]
    buildDir["./build<br/>reports, artefacts, sessions"]
  end

  ports{{"Published ports<br/>4000 app, 5433 source,<br/>5434 warehouse, 5435 bank DB"}}

  subgraph net["Compose network: qa-stack"]
    tests["tests<br/>Playwright 1.65.0 image<br/>runs on demand"]
    bankapp["bank-app<br/>Node 22, :4000"]
    bankinit["bank-init<br/>seed if empty, then exit"]
    bankdb[("bank-db<br/>PostgreSQL 17")]
    src[("source-db<br/>PostgreSQL 16")]
    wh[("warehouse-db<br/>PostgreSQL 16")]
  end

  browser & hostrun --> ports
  ports --> bankapp & bankdb & src & wh
  tests -->|"by service name"| bankapp
  tests --> bankdb & src & wh
  bankapp --> bankdb
  bankinit --> bankdb
  tests -.->|"bind mount"| buildDir
```

| Service                     | Image                    | Host port  | Notes                                                                             |
| --------------------------- | ------------------------ | ---------- | --------------------------------------------------------------------------------- |
| `bank-db`                   | `postgres:17`            | 5435       | Named volume `bank-data`                                                          |
| `bank-init`                 | `harbourline-bank:local` | none       | Built once by `bank-app`; `--if-empty` keeps data across restarts                 |
| `bank-app`                  | `harbourline-bank:local` | 4000       | `apps/bank/Dockerfile`; app deps only from the workspace lockfile; runs as `node` |
| `source-db`, `warehouse-db` | `postgres:16`            | 5433, 5434 | Seeded from `docker/etl/init/*.sql`                                               |
| `tests`                     | `qa-tests:local`         | none       | `docker/tests/Dockerfile`; profile `tests`; `BANK_AUTOSTART=0`, `BANK_REQUIRED=1` |

Ports avoid a local PostgreSQL on 5432. `.dockerignore` keeps `.env`, `node_modules`, `build/` and `.git` out of every image.

## 5. Harbourline Bank (system under test)

A fictional bank in `apps/bank`, built so the framework has one realistic target exercising UI, API,
authentication and data together. It shares no code with the framework.

```mermaid
flowchart TB
  subgraph app["bank-app (Express, one process)"]
    static["Static UI<br/>public/*.html, app.js, styles.css"]
    web["Web routes<br/>/login, /accounts, /transfer, /payees<br/>cookie session"]
    oauth["OAuth 2.0 server<br/>/oauth/token, /authorize, /revoke"]
    authn["authenticate<br/>Basic | Bearer JWT | session"]
    apir["/api/v1<br/>me, accounts, transactions,<br/>payees, transfers, ops"]
    ts["/test-support<br/>only with BANK_TEST_SUPPORT=1"]
    health["/health, /health/live"]
  end
  db[("PostgreSQL<br/>schema bank")]
  static --> apir
  web --> db
  oauth --> db
  apir --> authn --> db
  ts --> db
  health --> db
```

**Authentication.** Every `/api/v1` route accepts HTTP Basic, an OAuth bearer token (HS256 JWT, 15 min),
or the web session cookie. Scopes are checked per route (`accounts:read`, `payments:write`, ...).
Another customer's resources return 404, not 403, so ids can't be probed. Three wrong passwords lock a customer.

| Grant                            | Client                         | Notes                                     |
| -------------------------------- | ------------------------------ | ----------------------------------------- |
| `password`                       | `qa-automation` (confidential) | Customer token + refresh token            |
| `client_credentials`             | `ops-service`                  | Service token; only `/api/v1/ops/*`       |
| `authorization_code` + PKCE S256 | `harbour-mobile` (public)      | Sign-in and consent page; one-time codes  |
| `refresh_token`                  | confidential and public        | Rotating: the old token is revoked on use |

```mermaid
sequenceDiagram
  autonumber
  participant C as Mobile client (public)
  participant A as /oauth/authorize
  participant T as /oauth/token
  participant API as /api/v1
  C->>C: verifier = random, challenge = SHA256(verifier)
  C->>A: GET with client_id, redirect_uri, scope, state, challenge
  A-->>C: sign-in and consent page
  C->>A: POST credentials + allow
  A-->>C: 302 redirect_uri?code&state
  C->>T: grant_type=authorization_code, code, verifier
  T->>T: code unused, unexpired, same client and redirect, SHA256(verifier) = challenge
  T-->>C: access_token (JWT), refresh_token
  C->>API: Authorization: Bearer access_token
```

**Money movement.** `POST /transfers` runs in one database transaction: lock both accounts in id order,
check available funds and the daily payee limit, insert the transfer, update balances, write one ledger row
per side. An `Idempotency-Key` makes retries safe, including concurrent duplicates.

```mermaid
erDiagram
  customers ||--o{ accounts : owns
  customers ||--o{ payees : saves
  customers ||--o{ transfers : makes
  customers ||--o{ sessions : has
  customers ||--o{ refresh_tokens : holds
  accounts ||--o{ transactions : ledger
  transfers ||--|{ transactions : legs
  accounts ||--o{ transfers : "paid from"
  payees |o--o{ transfers : "paid to"
  oauth_clients ||--o{ oauth_codes : issues
  oauth_clients ||--o{ refresh_tokens : issues

  customers {
    int id PK
    text username UK
    text password_hash
    text status
    int failed_attempts
    bigint daily_limit_cents
  }
  accounts {
    int id PK
    int customer_id FK
    text type
    text account_number UK
    bigint balance_cents
    bigint credit_limit_cents
  }
  transactions {
    bigint id PK
    int account_id FK
    uuid transfer_id FK
    bigint amount_cents
    bigint balance_after_cents
  }
  transfers {
    uuid id PK
    int from_account_id FK
    int to_account_id FK
    int payee_id FK
    bigint amount_cents
    text idempotency_key
  }
```

Invariants the tests check in the database: an account's balance equals the sum of its transactions, and
every internal transfer has exactly two legs summing to zero. Money is integer cents throughout.
Secrets (passwords, client secrets, refresh tokens, auth codes, sessions) are stored only as scrypt or SHA-256 hashes.

## 6. Reporting

Every run writes to `build/` (paths defined once as `BUILD` in `@qa/core`).

```mermaid
flowchart LR
  run["playwright test"] --> list["list reporter<br/>terminal"]
  run --> html["html reporter"] --> pw["build/reports/playwright<br/>engineers"]
  run --> sr["stakeholder reporter"] --> st["build/reports/stakeholder<br/>index.html, summary.md,<br/>summary.json, history.json"]
  run --> art["build/test-results<br/>screenshots, videos, traces"]
  st -.->|"detailed report link"| pw
```

The stakeholder reporter turns results into a **run model**: counts, pass rate, release status, results
per product area (Playwright project) and per quality dimension (tags), failures, flaky tests, skip reasons.
It then renders one self-contained HTML page and a Markdown summary, and appends the run to `history.json`
(last 30 runs) for the trend chart.

| Release status   | Rule                                                        |
| ---------------- | ----------------------------------------------------------- |
| Not ready        | Any `@smoke` or `@security` failure, or pass rate below 90% |
| At risk          | Any other failure, or any flaky test                        |
| Ready to release | Everything executed passed                                  |
| No results       | Nothing ran                                                 |

The page is built for people who don't read test code: each status has an icon and a word next to its colour,
because red and green are nearly identical for deuteranopes. Every chart has a table view, light and dark themes,
and print styles. axe reports no WCAG 2 A/AA violations.

## 7. CI pipeline

`.github/workflows/tests.yml`. Pull requests run `@smoke`; pushes to `main` and the nightly run do everything.

```mermaid
flowchart LR
  static["Typecheck and lint"] --> api["API"]
  static --> web["Web<br/>2 shards"]
  static --> etl["ETL<br/>docker/etl"]
  static --> bank["Bank (Docker)<br/>docker/bank, BANK_REQUIRED=1"]
  static --> mobile["Mobile<br/>device cloud, when enabled"]
  api & web & etl & bank & mobile -->|"blob reports"| report["Merged report<br/>merge.config.ts"]
  cache[("Actions cache<br/>history.json per branch")] <--> report
  report --> artefacts["Artifacts: quality-report, html-report"]
  report --> summary["Job summary<br/>summary.md"]
```

Installs use `--frozen-lockfile`. No secrets are needed until stage 2 (your own environments); the staged
rollout is in [CI.md](CI.md).

## 8. Agents and MCP

Agents work through MCP servers registered in `.mcp.json`. The framework's own server exposes this repo,
so generated tests use existing page objects and fixtures instead of raw locators.

```mermaid
flowchart LR
  agent["Agent client<br/>Claude Code, VS Code, ..."]
  subgraph servers[".mcp.json"]
    pw["playwright<br/>browser control"]
    ap["appium<br/>device control"]
    qa["qa-framework<br/>packages/mcp-server"]
    data["data<br/>read-only SQL"]
  end
  agent --> pw & ap & qa & data
  qa -->|"list_page_objects, list_fixtures,<br/>get_env_config, list_etl_rules,<br/>get_etl_mapping, qa://standards"| repo["Repository files"]
  qa -->|"run_tests, get_last_failures"| runner["Playwright CLI<br/>build/reports/mcp"]
```

Guardrails: `run_tests` refuses production environments; secrets are redacted from `get_env_config`;
agent changes arrive as PRs labelled `ai-generated` with the same CI gates; the healer may change locators
and waits only. The `etl-test-generator` agent in `.claude/agents/` turns a mapping spec into rules and tests.

## 9. Configuration and secrets

```mermaid
flowchart LR
  file["config/env/TEST_ENV.json"] --> merge["loadConfig()<br/>Zod-validated, cached"]
  envv["Environment variables<br/>.env locally, secrets in CI"] -->|"override when non-empty"| merge
  defaults["Schema defaults<br/>e.g. bank section"] --> merge
  merge --> fixtures["Fixtures and playwright.config.ts"]
```

- `TEST_ENV` picks the file (`dev` by default). Environment variables override it; empty values are ignored,
  so unset CI secrets fall back to the file.
- `.env` is git-ignored and Docker-ignored. Only synthetic demo credentials live in `config/env/dev.json`.
- Harbourline's settings have local defaults (base URL, DB URL, OAuth clients), so no env file is needed for it.

## 10. Design decisions

| Decision                                                  | Why                                                                              | Trade-off                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| One runner (Playwright Test) for every channel            | One way to tag, retry, shard, report and debug; fixtures compose across channels | Native mobile goes through WebdriverIO inside Playwright, not a mobile-first runner |
| Specs import only `@qa/test`                              | Fixtures are the API; drivers and locators stay swappable                        | One more layer to learn                                                             |
| Lazy, merged fixtures                                     | A spec pays only for what it uses; parallel by default                           | Fixture graph needs care (worker vs test scope)                                     |
| A local bank as the reference system under test           | Exercises UI, API, OAuth and data invariants together, offline and deterministic | Extra code to maintain; it is not your real system                                  |
| Each state-changing test owns its data (test-support API) | Full parallelism, no cross-test interference, no shared fixtures to reset        | Needs a gated test-only endpoint in the system under test                           |
| Skip locally, fail in CI when a system is down            | Laptops stay usable; CI can't go green by skipping everything                    | Two behaviours to understand (`BANK_REQUIRED`)                                      |
| Everything generated under `build/`                       | One folder to clean, cache, mount or upload                                      | Paths must come from `BUILD`, not literals                                          |
| Self-contained stakeholder report                         | Email-able, offline, printable; independent of CI tooling                        | Custom code instead of an off-the-shelf dashboard                                   |
| Docker stack including the runner                         | Same versions everywhere; only Docker needed                                     | Image builds; the test image must match the Playwright version                      |

## 11. Extending the framework

**Point it at your own web app or API**

1. Add `config/env/<name>.json` and run with `TEST_ENV=<name>`; put secrets in `.env` / CI secrets.
2. Add page objects under `packages/web/src/pages/<app>/` (one class per file) and clients under
   `packages/api/src/clients/<app>/`, with Zod schemas.
3. Expose them as fixtures in the package's `fixtures.ts`; they appear in `@qa/test` automatically.
4. Add a Playwright project per channel and a friendly area name in `packages/reporting/src/stakeholder-reporter.ts`.

**Add a database platform** (SQL Server, Snowflake, ...): implement `DbClient` in `packages/etl/src/db.ts`
and route to it in `connect()`.

**Add a pipeline orchestrator** (ADF, Glue, dbt Cloud): implement `PipelineRunner` in
`packages/etl/src/pipeline.ts` and select it in `createPipeline()`.

**Add a quality dimension**: add a tag to `DIMENSIONS` in `packages/reporting/src/model.ts` and to
[CODING_STANDARDS.md](CODING_STANDARDS.md).

**Add a containerised system under test**: add a compose file under `docker/<name>/`, include it from
`compose.yaml`, and add it to the `tests` service's `depends_on` and environment.

## 12. Known limitations

- Native mobile isn't containerised; it needs Appium and an emulator, simulator or device cloud.
- Reports from the Docker runner show no branch or commit, because `.git` isn't copied into the image.
- CI's ETL and bank jobs start their own containers and run tests on the runner, not in the `tests` image.
- The CI trend history lives in the Actions cache, which GitHub evicts after 7 days without use.
- Only a PostgreSQL `DbClient` and the local and Airflow pipeline runners exist today.
