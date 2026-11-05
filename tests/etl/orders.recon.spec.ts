import { test, expect } from '@qa/test';
import { OrderBuilder, type Order } from '@qa/data';
import { diffByHash, toCsv } from '@qa/etl';
import { faker } from '@faker-js/faker';

/**
 * Source-to-target reconciliation for the orders_daily job.
 * Arrange: seed a unique run date in source. Act: run the pipeline. Assert: counts, totals, row hashes.
 */
test.describe('orders_daily reconciliation', () => {
  let runDate: string;
  let orders: Order[];

  test.beforeEach(async ({ source, cleanup }) => {
    // A unique far-future date isolates this test's rows from other runs
    runDate = faker.date.between({ from: '2030-01-01', to: '2039-12-31' }).toISOString().slice(0, 10);
    orders = [
      ...OrderBuilder.many(20, runDate),
      OrderBuilder.default().on(runDate).withStatus('CANCELLED').build(), // must be filtered out
      OrderBuilder.default().on(runDate).withStatus('SHIPPED').withAmount(0).build(), // boundary
    ];
    for (const o of orders) {
      await source.query(
        `insert into sales.orders (order_id, customer_id, order_date, amount, currency, status)
         values ($1,$2,$3,$4,$5,$6) on conflict (order_id) do nothing`,
        [o.order_id, o.customer_id, o.order_date, o.amount, o.currency, o.status],
      );
    }
    cleanup.add('source orders', () => source.query('delete from sales.orders where order_date = $1', [runDate]));
  });

  test('counts and totals match after load @etl @recon @smoke', async ({ source, warehouse, pipeline, cleanup }) => {
    const run = await pipeline.run('orders_daily', { runDate });
    cleanup.add('warehouse orders', () =>
      warehouse.query('delete from dw.fact_orders where order_date = $1', [runDate]),
    );
    expect(run.state).toBe('success');

    const [src, tgt] = await Promise.all([
      source.one(
        `select count(*) n, coalesce(sum(round(amount * 1.0, 2)),0) total
           from sales.orders where order_date = $1 and status <> 'CANCELLED'`,
        [runDate],
      ),
      warehouse.one(
        `select count(*) n, coalesce(sum(amount_aud),0) total from dw.fact_orders where order_date = $1`,
        [runDate],
      ),
    ]);
    expect(tgt).toEqual(src);
  });

  test('every row matches by key and hash @etl @recon', async ({ source, warehouse, pipeline, cleanup, config }) => {
    await pipeline.run('orders_daily', { runDate });
    cleanup.add('warehouse orders', () =>
      warehouse.query('delete from dw.fact_orders where order_date = $1', [runDate]),
    );

    const diffs = await diffByHash(source, warehouse, {
      // Source side applies the mapping rules so both hashes describe the target shape
      sourceSql: `select order_id::text key,
                         md5(concat_ws('|', customer_id, order_date, round(amount * 1.0, 2), lower(status))) hash
                    from sales.orders where order_date = $1 and status <> 'CANCELLED'`,
      targetSql: `select order_id::text key,
                         md5(concat_ws('|', customer_id, order_date, amount_aud, status)) hash
                    from dw.fact_orders where order_date = $1`,
      params: [runDate],
      maxRows: config.etl.maxDiffRows,
    });

    if (diffs.length) await test.info().attach('row-diffs.csv', { body: toCsv(diffs), contentType: 'text/csv' });
    expect(diffs, 'mismatched rows attached as CSV').toHaveLength(0);
  });
});
