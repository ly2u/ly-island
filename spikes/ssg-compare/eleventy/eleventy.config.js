import { feedPlugin } from '@11ty/eleventy-plugin-rss';
import { SITE, SITE_NAME, SITE_SUMMARY } from '../shared/island-data.mjs';

export default function (eleventyConfig) {
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
