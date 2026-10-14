// Data for every note in this folder, and the front matter rules.
// The rules mirror the Astro content collection schema in astro/src/content.config.ts.

const KINDS = ['article', 'note', 'project'];

/** @param {unknown} value */
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

export default {
  tags: 'notes',
  layout: 'note.11ty.js',
  // Eleventy 3 runs this for each note; throwing fails the build.
  eleventyDataSchema(data) {
    const problems = [];
    if (typeof data.title !== 'string' || data.title === '') problems.push('title must be a non-empty string');
    const date = data.date instanceof Date ? data.date : new Date(data.date ?? Number.NaN);
    if (data.date === undefined || Number.isNaN(date.getTime())) problems.push('date must be a date');
    if (!KINDS.includes(data.kind)) problems.push(`kind must be one of ${KINDS.join(', ')}, not ${JSON.stringify(data.kind)}`);
    if (data.summary !== undefined && typeof data.summary !== 'string') problems.push('summary must be a string');
    if (data.tags !== undefined && typeof data.tags !== 'string' && !isStringList(data.tags)) {
      problems.push('tags must be a list of strings');
    }
    if (problems.length > 0) throw new Error(problems.join('; '));
  },
};
