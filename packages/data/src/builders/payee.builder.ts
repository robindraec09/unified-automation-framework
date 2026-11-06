import { faker } from '@faker-js/faker';

export interface Payee {
  name: string;
  bsb: string;
  accountNumber: string;
  nickname?: string;
}

/** Valid, unique-enough payees for Harbourline Bank tests. */
export class PayeeBuilder {
  private payee: Payee = {
    name: faker.person.fullName(),
    bsb: `${faker.string.numeric(3)}-${faker.string.numeric(3)}`,
    accountNumber: faker.string.numeric(8),
  };

  static default() {
    return new PayeeBuilder();
  }

  named(name: string) {
    this.payee.name = name;
    return this;
  }

  withNickname(nickname: string) {
    this.payee.nickname = nickname;
    return this;
  }

  withBsb(bsb: string) {
    this.payee.bsb = bsb;
    return this;
  }

  withAccountNumber(accountNumber: string) {
    this.payee.accountNumber = accountNumber;
    return this;
  }

  build(): Payee {
    return { ...this.payee };
  }
}
