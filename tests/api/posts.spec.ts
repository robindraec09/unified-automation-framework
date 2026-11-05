import { test, expect } from '@qa/test';
import { PostSchema, PostListSchema } from '@qa/api';
import { PostBuilder } from '@qa/data';

test.describe('Posts API', () => {
  test('list posts matches contract @smoke @contract', async ({ posts }) => {
    const res = await posts.list();
    expect(res.status()).toBe(200);
    await expect(res).toMatchSchema(PostListSchema);
  });

  test('create post returns 201 with an id @functional', async ({ posts }) => {
    const post = PostBuilder.default().withUser(1).build();
    const res = await posts.create(post);
    expect(res.status()).toBe(201);
    await expect(res).toMatchSchema(PostSchema);
    expect(await res.json()).toMatchObject({ ...post });
  });

  test('unknown post returns 404 @negative', async ({ posts }) => {
    const res = await posts.byId(999_999);
    expect(res.status()).toBe(404);
  });
});
