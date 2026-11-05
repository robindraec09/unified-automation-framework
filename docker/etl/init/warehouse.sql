create schema stg;
create schema dw;

create table stg.orders (
  order_id     bigint,
  customer_id  int,
  order_date   date,
  amount       numeric(12,2),
  currency     char(3),
  status       varchar(16)
);

create table dw.dim_customer (
  customer_id  int primary key,
  name         text not null
);
insert into dw.dim_customer select g, 'Customer ' || g from generate_series(1, 500) g;

create table dw.fact_orders (
  order_id     bigint primary key,
  customer_id  int not null,
  order_date   date not null,
  amount_aud   numeric(12,2) not null,
  status       varchar(16) not null,
  loaded_at    timestamptz not null default now()
);
create index on dw.fact_orders (order_date);
