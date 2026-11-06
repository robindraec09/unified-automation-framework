# Harbourline Bank (local system under test)

A small, fictional internet bank that runs locally so the framework has a realistic target:
a banking UI, a REST API with **Basic auth and OAuth 2.0**, and a **PostgreSQL** database.
Harbourline is not a real bank, and its UI says so on every page.

One Node process (`src/server.ts`, Express) serves everything on <http://localhost:4000>.

## Run it

### Docker (default)

```bash
pnpm bank:up       # build + start PostgreSQL 17, seed it (first start only) and the app; waits until healthy
pnpm test:bank     # bank-api + bank-web from your machine, against the running containers
pnpm bank:reset    # reload the seed data (keeps containers running)
pnpm bank:logs     # follow the app log
pnpm bank:down     # stop and remove the bank containers (the data volume is kept)
pnpm stack:down    # stop the whole stack and delete all data

# Or run the tests in a container too (see the root README, "Everything in Docker"):
docker compose run --rm --build tests --project=bank-api --project=bank-web
```

| Container   | What                                                            | Host port |
| ----------- | --------------------------------------------------------------- | --------- |
| `bank-db`   | PostgreSQL 17, data in volume `bank-data`                       | 5435      |
| `bank-init` | one-off: creates schema + seed when the DB is empty, then exits | none      |
| `bank-app`  | the app, with test support on                                   | 4000      |

Compose file: [docker/bank/docker-compose.yml](../../docker/bank/docker-compose.yml), included in the root
[compose.yaml](../../compose.yaml) stack (project `qa-stack`). Image: [Dockerfile](Dockerfile)
(installs only this app's dependencies from the workspace lockfile, runs as the `node` user).
Ports avoid clashes with a local PostgreSQL install (5432) and the ETL demo (5433/5434).

### Without the app container

`pnpm test:bank` starts the app on the host itself when nothing is listening on port 4000
(`reuseExistingServer`), so you can keep just `bank-db` running and debug the app locally:
`docker compose up -d --wait bank-db bank-init`, then `pnpm bank:start`. Inside the stack, containers reach
the app as `http://bank-app:4000`; its OAuth callback is registered for that host too (`BANK_REDIRECT_URIS`).

### Your local PostgreSQL instead of Docker

1. In `.env`: `BANK_DB_URL=postgres://bank_app:bank_app@localhost:5432/bank` and
   `BANK_DB_ADMIN_URL=postgres://postgres:<password>@localhost:5432/postgres` (a superuser, used once).
2. `pnpm bank:db:init` creates the role and database and loads the seed (re-run to reset).
3. `pnpm test:bank`.

Settings come from `.env` (see `src/config.ts`): `BANK_DB_URL`, `BANK_PORT`, `BANK_JWT_SECRET`,
`BANK_ACCESS_TOKEN_TTL`, `BANK_TEST_SUPPORT`.

## Seed data

| Customer ID   | Password       | Notes                                                                                         |
| ------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `alex.morgan` | `Harbour#2026` | Everyday $5,240.50, Bonus Saver $18,250.00, Low Rate Card -$1,320.45 (limit $6,000), 2 payees |
| `jordan.lee`  | `Harbour#2026` | Second customer, used to prove customers cannot see each other's data                         |
| `sam.locked`  | `Harbour#2026` | Locked account                                                                                |

Three wrong passwords in a row lock a customer. Tests that try wrong passwords use a throwaway
customer from `/test-support`, never the seeded ones.

| OAuth client     | Secret                       | Grants                                      | Scopes           |
| ---------------- | ---------------------------- | ------------------------------------------- | ---------------- |
| `qa-automation`  | `qa-automation-secret`       | password, refresh_token, authorization_code | customer scopes  |
| `ops-service`    | `ops-service-secret`         | client_credentials                          | `customers:read` |
| `harbour-mobile` | none (public, PKCE required) | authorization_code, refresh_token           | customer scopes  |

Customer scopes: `accounts:read transactions:read payees:read payees:write payments:write`.

## API

Every `/api/v1` route accepts any of: `Authorization: Basic`, `Authorization: Bearer <access token>`,
or the web session cookie. Errors are `{ "error": "<code>", "message": "..." }`.

| Method          | Path                                              | Scope                          | Notes                                                                                |
| --------------- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| GET             | `/health`                                         | none                           | 200 when the DB answers, 503 otherwise (`/health/live` = process only)               |
| GET             | `/api/v1/me`                                      | any                            | includes `authMethod`                                                                |
| GET             | `/api/v1/accounts`, `/accounts/:id`               | `accounts:read`                | another customer's account is 404                                                    |
| GET             | `/api/v1/accounts/:id/transactions?limit&from&to` | `transactions:read`            | newest first                                                                         |
| GET/POST/DELETE | `/api/v1/payees[/:id]`                            | `payees:read` / `payees:write` | 409 on duplicate BSB + account                                                       |
| POST            | `/api/v1/transfers`                               | `payments:write`               | `Idempotency-Key` header supported; 422 `insufficient_funds`, `daily_limit_exceeded` |
| GET             | `/api/v1/transfers/:id`                           | `accounts:read`                |                                                                                      |
| GET             | `/api/v1/ops/customers/:id/accounts`              | `customers:read`               | service (client_credentials) tokens only                                             |

OAuth 2.0 (`/.well-known/oauth-authorization-server` has the metadata):

| Endpoint                    | Purpose                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /oauth/token`         | `password`, `client_credentials`, `authorization_code` (+PKCE S256), `refresh_token` (rotating). Client auth by Basic header or form body |
| `GET/POST /oauth/authorize` | sign-in and consent page; redirects with `code` and `state`                                                                               |
| `POST /oauth/revoke`        | revoke a refresh token                                                                                                                    |
| `GET /oauth/callback`       | registered redirect target that displays the code                                                                                         |

Access tokens are HS256 JWTs (15 minutes). Refresh tokens, auth codes and sessions are opaque;
only their SHA-256 is stored.

## Test support

With `BANK_TEST_SUPPORT=1`, `POST /test-support/customers` creates a throwaway `qa_*` customer
with accounts and balances you choose, and `DELETE /test-support/customers/:id` removes it.
The framework's `bankCustomer` fixture uses this, so each test owns its own data and tests run in parallel.
Never enable it outside local and test environments.

## Database

Schema `bank` (`db/schema.sql`): `customers`, `accounts`, `transactions` (signed ledger with
running balance), `transfers`, `payees`, `oauth_clients`, `oauth_codes`, `refresh_tokens`, `sessions`.
Money is integer cents. The invariant the tests check: an account's balance equals the sum of its
transactions, and every internal transfer has exactly two legs that sum to zero.
