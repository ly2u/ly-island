import { feedPlugin } from '@11ty/eleventy-plugin-rss';
import { SITE, SITE_NAME, SITE_SUMMARY } from '../shared/island-data.mjs';

export default function (eleventyConfig) {
  // The notes are copied in at build time and kept out of Git, so Eleventy
  // must not skip what .gitignore lists.
  eleventyConfig.setUseGitIgnore(false);
  eleventyConfig.addPlugin(feedPlugin, {
    type: 'rss',
    outputPath: '/feed.xml',
    collection: { name: 'notes', limit: 0 },
    metadata: {
      language: 'zh-CN',
      title: SITE_NAME,
      subtitle: SITE_SUMMARY,
      base: `${SITE}/`,
      author: { name: SITE_NAME },
    },
  });
  return { dir: { input: 'src', output: 'dist' } };
}
