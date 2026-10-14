import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const notes = defineCollection({
  loader: glob({ base: '../content', pattern: '*.md' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['article', 'note', 'project']),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { notes };
