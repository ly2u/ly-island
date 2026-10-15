// Keep YAML dates lexical until the schema has checked them. Astro's default
// timestamp tag normalizes calendar overflow before validation; coercion also
// hides wrong types. Keep those two mistakes visible to the string schema.
import { parseDocument } from 'yaml';
import { SLUG } from '../../../packages/core/src/records.js';

export function recordLoader(glob) {
  const loader = glob({
    base: './content/records',
    pattern: '*.md',
    generateId({ entry }) {
      const slug = entry.endsWith('.md') ? entry.slice(0, -3) : '';
      if (!SLUG.test(slug)) throw new Error(`${entry}: the file name must use lowercase letters, digits and single hyphens`);
      return slug;
    },
  });
  return {
    name: 'island-records',
    async load(context) {
      const entryTypes = new Map(context.entryTypes);
      const markdown = entryTypes.get('.md');
      if (!markdown) throw new Error('Markdown entry type is required');
      entryTypes.set('.md', {
        ...markdown,
        async getEntryInfo(args) {
          const info = await markdown.getEntryInfo(args);
          const document = parseDocument(info.rawData, { schema: 'core', merge: true });
          const problem = document.errors[0] ?? document.warnings[0];
          if (problem) throw new Error(`${args.fileUrl}: ${problem.message}`);
          const data = document.toJS({ maxAliasCount: 100 });
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${args.fileUrl}: expected YAML front matter`);
          return { ...info, data };
        },
      });
      return loader.load({ ...context, entryTypes });
    },
  };
}
