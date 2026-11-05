import { z } from 'zod';

export const PostSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string(),
});

export const PostListSchema = z.array(PostSchema);
