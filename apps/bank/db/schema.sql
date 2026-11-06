-- Harbourline Bank (fictional) - schema for the local system under test.
-- Re-runnable: drops and recreates the `bank` schema. Money is stored in integer cents.

drop schema if exists bank cascade;
create schema bank;
set search_path = bank;

create table customers (
  id               serial primary key,
  username         text not null unique,
  full_name        text not null,
  email            text not null,
  password_hash    text not null,
  status           text not null default 'active' check (status in ('active', 'locked')),
  failed_attempts  int  not null default 0,
  daily_limit_cents bigint not null default 1000000, -- $10,000 per day to external payees
  created_at       timestamptz not null default now()
);

create table accounts (
  id                 serial primary key,
  customer_id        int not null references customers(id) on delete cascade,
  name               text not null,
  type               text not null check (type in ('transaction', 'savings', 'credit')),
  bsb                text not null,
  account_number     text not null unique,
  balance_cents      bigint not null,
  credit_limit_cents bigint not null default 0,
  currency           text not null default 'AUD',
  created_at         timestamptz not null default now()
);
create index on accounts (customer_id);

create table payees (
  id             serial primary key,
  customer_id    int not null references customers(id) on delete cascade,
  name           text not null,
  bsb            text not null check (bsb ~ '^\d{3}-\d{3}$'),
  account_number text not null check (account_number ~ '^\d{6,9}$'),
  nickname       text,
  created_at     timestamptz not null default now(),
  unique (customer_id, bsb, account_number)
);

create table transfers (
  id              uuid primary key default gen_random_uuid(),
  customer_id     int not null references customers(id) on delete cascade,
  from_account_id int not null references accounts(id) on delete cascade,
  to_account_id   int references accounts(id) on delete cascade,
  payee_id        int references payees(id) on delete set null,
  amount_cents    bigint not null check (amount_cents > 0),
  description     text not null default '',
  status          text not null default 'completed',
  idempotency_key text,
  created_at      timestamptz not null default now(),
  check ((to_account_id is null) <> (payee_id is null)),
  unique (customer_id, idempotency_key)
);

create table transactions (
  id                  bigserial primary key,
  account_id          int not null references accounts(id) on delete cascade,
  transfer_id         uuid references transfers(id) on delete cascade,
  posted_at           timestamptz not null default now(),
  description         text not null,
  amount_cents        bigint not null, -- signed: negative = debit
  balance_after_cents bigint not null
);
create index on transactions (account_id, posted_at desc);

create table oauth_clients (
  client_id          text primary key,
  client_secret_hash text,           -- null = public client (PKCE required)
  name               text not null,
  grant_types        text[] not null,
  scopes             text[] not null,
  redirect_uris      text[] not null default '{}'
);

create table oauth_codes (
  code_hash      text primary key,
  client_id      text not null references oauth_clients(client_id) on delete cascade,
  customer_id    int not null references customers(id) on delete cascade,
  redirect_uri   text not null,
  scopes         text[] not null,
  code_challenge text,
  expires_at     timestamptz not null,
  used           boolean not null default false
);

create table refresh_tokens (
  token_hash  text primary key,
  client_id   text not null references oauth_clients(client_id) on delete cascade,
  customer_id int not null references customers(id) on delete cascade,
  scopes      text[] not null,
  expires_at  timestamptz not null,
  revoked     boolean not null default false
);

create table sessions (
  token_hash  text primary key,
  customer_id int not null references customers(id) on delete cascade,
  expires_at  timestamptz not null
);
