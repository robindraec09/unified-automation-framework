create schema sales;

create table sales.orders (
  order_id     bigint primary key,
  customer_id  int not null,
  order_date   date not null,
  amount       numeric(12,2) not null,
  currency     char(3) not null default 'AUD',
  status       varchar(16) not null
);
create index on sales.orders (order_date);
