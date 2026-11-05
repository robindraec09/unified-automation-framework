import { test as base, request as pwRequest } from '@playwright/test';
import { loadConfig } from '@qa/core';
import { PostsClient } from './clients/posts.client';

export type ApiFixtures = {
  posts: PostsClient;
};

/**
 * API fixtures. A dedicated request context per test with the API base URL and auth,
 * so UI and mobile tests can also use these clients to arrange data.
 */
export const apiTest = base.extend<ApiFixtures>({
  posts: async ({}, use) => {
    const cfg = loadConfig();
    const ctx = await pwRequest.newContext({
      baseURL: cfg.api.baseUrl,
      extraHTTPHeaders: cfg.api.token ? { Authorization: `Bearer ${cfg.api.token}` } : {},
    });
    await use(new PostsClient(ctx));
    await ctx.dispose();
  },
});
