// Front matter of a record. These are the shapes; the rules that span fields
// (dates in order, only projects can be done, file names) are checked by
// packages/core/src/records.js, which lists every problem at once.

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const records = defineCollection({
  loader: glob({ base: './content/records', pattern: '*.md' }),
  schema: z
    .object({
      title: z.string().optional(),
      date: z.coerce.date(),
      kind: z.enum(['article', 'note', 'project']),
      summary: z.string().optional(),
      tags: z.array(z.string()).default([]),
      done: z.coerce.date().optional(),
      withdrawn: z.coerce.date().optional(),
      updated: z.coerce.date().optional(),
      language: z.string().optional(),
      draft: z.boolean().default(false),
    })
    .strict(),
});

export const collections = { records };
