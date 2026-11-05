import type { Post } from '@qa/data';
import { BaseClient } from './base.client';

/** Example service client (demo API: jsonplaceholder). Replace with your services. */
export class PostsClient extends BaseClient {
  list(userId?: number) {
    return this.get('/posts', userId ? { userId } : undefined);
  }

  byId(id: number) {
    return this.get(`/posts/${id}`);
  }

  create(post: Post) {
    return this.post('/posts', post);
  }

  remove(id: number) {
    return this.delete(`/posts/${id}`);
  }
}
