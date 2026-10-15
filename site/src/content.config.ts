// Front matter of a record. These are the shapes; the rules that span fields
// (dates in order, only projects can be done, file names) are checked by
// packages/core/src/records.js, which lists every problem at once.

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { isRecordDate } from '../../packages/core/src/dates.js';
import { recordLoader } from './lib/record-loader.js';

const date = z.string().refine(isRecordDate, 'expected a real YYYY-MM-DD date or RFC 3339 timestamp with an offset');

const records = defineCollection({
  loader: recordLoader(glob),
  schema: z
    .object({
      title: z.string().optional(),
      date,
      kind: z.enum(['article', 'note', 'project']),
      summary: z.string().optional(),
      tags: z.array(z.string()).default([]),
      done: date.optional(),
      withdrawn: date.optional(),
      updated: date.optional(),
      language: z.string().optional(),
      draft: z.boolean().default(false),
    })
    .strict(),
});

export const collections = { records };
