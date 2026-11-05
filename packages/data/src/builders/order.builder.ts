import { faker } from '@faker-js/faker';

export interface Order {
  order_id: number;
  customer_id: number;
  order_date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  status: 'NEW' | 'PAID' | 'SHIPPED' | 'CANCELLED';
}

/** Used to seed ETL source tables with known rows. */
export class OrderBuilder {
  private order: Order = {
    order_id: faker.number.int({ min: 100_000, max: 999_999 }),
    customer_id: faker.number.int({ min: 1, max: 500 }),
    order_date: new Date().toISOString().slice(0, 10),
    amount: Number(faker.commerce.price({ min: 5, max: 500 })),
    currency: 'AUD',
    status: 'PAID',
  };

  static default() {
    return new OrderBuilder();
  }

  on(date: string) {
    this.order.order_date = date;
    return this;
  }

  withAmount(amount: number) {
    this.order.amount = amount;
    return this;
  }

  withStatus(status: Order['status']) {
    this.order.status = status;
    return this;
  }

  build(): Order {
    return { ...this.order };
  }

  static many(n: number, date: string): Order[] {
    return Array.from({ length: n }, () => OrderBuilder.default().on(date).build());
  }
}
