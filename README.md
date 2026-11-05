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
tests/         setup/, web/, api/, mobile/, etl/
config/        env/*.json, devices/*.json, etl/rules/*.yml, etl/mappings/*.md
docker/etl/    local source + warehouse Postgres for the ETL demo
seed/          seed spec for the planner agent
specs/         Markdown test plans (planner output)
.mcp.json      Playwright MCP, Appium MCP, framework MCP, data MCP
```

## Quick start

```bash
pnpm install
pnpm exec playwright install --with-deps
cp .env.example .env

pnpm test:api            # demo API (jsonplaceholder)
pnpm test:web            # demo web app (saucedemo), runs the setup project first
pnpm etl:up && pnpm test:etl   # ETL demo against local Docker Postgres
pnpm report
```

The sample targets are public demo apps so everything runs on day one. Replace them with your systems:
point `config/env/*.json` at your URLs and swap the example page objects, clients and mappings.

## Channels

| Project | Driver | Typical tags |
| --- | --- | --- |
| `api` | Playwright APIRequestContext | `@smoke @contract @functional @negative` |
| `web-chromium` / `web-firefox` / `web-webkit` | Playwright | `@smoke @regression @a11y` |
| `mobile-web` | Playwright device emulation | `@smoke` |
| `android` / `ios` | Appium via WebdriverIO | `@smoke @device` |
| `etl` | DB + pipeline fixtures | `@etl @recon @dq` |

### Mobile
1. Install Appium 2+ and drivers: `npm i -g appium && appium driver install uiautomator2` (and `xcuitest` on macOS).
2. Put your build in `apps/` or upload it to your device cloud; adjust `config/devices/*.json`.
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
