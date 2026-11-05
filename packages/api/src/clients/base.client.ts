import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Thin typed wrapper over Playwright's APIRequestContext. One subclass per service. */
export abstract class BaseClient {
  constructor(
    protected readonly request: APIRequestContext,
    protected readonly basePath = '',
  ) {}

  protected get(path: string, params?: Record<string, string | number>): Promise<APIResponse> {
    return this.request.get(`${this.basePath}${path}`, { params });
  }

  protected post(path: string, data: unknown): Promise<APIResponse> {
    return this.request.post(`${this.basePath}${path}`, { data });
  }

  protected put(path: string, data: unknown): Promise<APIResponse> {
    return this.request.put(`${this.basePath}${path}`, { data });
  }

  protected delete(path: string): Promise<APIResponse> {
    return this.request.delete(`${this.basePath}${path}`);
  }
}
