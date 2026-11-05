# Mapping: sales.orders → dw.fact_orders

Job: `orders_daily` (param `runDate`, YYYY-MM-DD). Grain: one row per order.

| Target column | Source | Rule |
| --- | --- | --- |
| order_id | sales.orders.order_id | direct |
| customer_id | sales.orders.customer_id | direct; must exist in dw.dim_customer |
| order_date | sales.orders.order_date | direct |
| amount_aud | sales.orders.amount | amount × FX rate to AUD (demo: 1.0), rounded to 2 dp |
| status | sales.orders.status | lower-cased |
| loaded_at | — | load timestamp |

Filter: rows with status `CANCELLED` are excluded.

This file is also the input the ETL agent reads (via the framework MCP) to draft rule YAML and reconciliation tests.
