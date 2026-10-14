import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const notes = defineCollection({
  // SPIKE_CONTENT lets measure.mjs build a folder with a deliberately bad note.
  loader: glob({ base: process.env.SPIKE_CONTENT ?? '../content', pattern: '*.md' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    kind: z.enum(['article', 'note', 'project']),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { notes };
