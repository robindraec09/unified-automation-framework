import { faker } from '@faker-js/faker';

export interface Post {
  userId: number;
  title: string;
  body: string;
}

/** Builder pattern: sensible defaults, override only what the test cares about. */
export class PostBuilder {
  private post: Post = {
    userId: faker.number.int({ min: 1, max: 10 }),
    title: faker.lorem.sentence(),
    body: faker.lorem.paragraph(),
  };

  static default() {
    return new PostBuilder();
  }

  withUser(userId: number) {
    this.post.userId = userId;
    return this;
  }

  withTitle(title: string) {
    this.post.title = title;
    return this;
  }

  build(): Post {
    return { ...this.post };
  }
}
