import type { DbClient } from './db';

type LocalJob = (source: DbClient, target: DbClient, params: Record<string, string>) => Promise<void>;

/**
 * Demo ETL jobs for the local Docker setup, standing in for real pipelines.
 * orders_daily: extract one day of orders from source, load to staging, transform into dw.fact_orders.
 * Transformation rules (documented in config/etl/mappings/orders.md):
 *   - CANCELLED orders are excluded
 *   - amount_aud = amount * fx rate (all demo rows are AUD, rate 1.0)
 *   - status is lower-cased
 */
export const localJobs: Record<string, LocalJob> = {
  async orders_daily(source, target, { runDate }) {
    const rows = await source.query<{
      order_id: number;
      customer_id: number;
      order_date: string;
      amount: number;
      currency: string;
      status: string;
    }>(
      `select order_id, customer_id, to_char(order_date,'YYYY-MM-DD') order_date, amount, currency, status
         from sales.orders where order_date = $1`,
      [runDate],
    );

    await target.query('delete from stg.orders where order_date = $1', [runDate]);
    for (const r of rows) {
      await target.query(
        `insert into stg.orders (order_id, customer_id, order_date, amount, currency, status)
         values ($1,$2,$3,$4,$5,$6)`,
        [r.order_id, r.customer_id, r.order_date, r.amount, r.currency, r.status],
      );
    }

    await target.query('delete from dw.fact_orders where order_date = $1', [runDate]);
    await target.query(
      `insert into dw.fact_orders (order_id, customer_id, order_date, amount_aud, status, loaded_at)
       select order_id, customer_id, order_date, round(amount * 1.0, 2), lower(status), now()
         from stg.orders
        where order_date = $1 and status <> 'CANCELLED'`,
      [runDate],
    );
  },
};
