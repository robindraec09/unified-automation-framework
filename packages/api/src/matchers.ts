import { expect as base, type APIResponse } from '@playwright/test';
import type { ZodTypeAny } from 'zod';

/** Custom matchers: `await expect(res).toMatchSchema(PostSchema)` */
export const apiExpect = base.extend({
  async toMatchSchema(received: APIResponse, schema: ZodTypeAny) {
    const body = await received.json().catch(() => undefined);
    const result = schema.safeParse(body);
    return {
      pass: result.success,
      name: 'toMatchSchema',
      message: () =>
        result.success
          ? 'expected response not to match schema'
          : `response does not match schema:\n${JSON.stringify(result.error.issues, null, 2)}`,
    };
  },
});
