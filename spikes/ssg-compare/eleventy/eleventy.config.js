import { rssPlugin } from '@11ty/eleventy-plugin-rss';
import { SITE, SITE_NAME, SITE_SUMMARY } from '../shared/island-data.mjs';

export default function (eleventyConfig) {
  // The notes are copied in at build time and listed in .gitignore, so
  // Eleventy must not skip what .gitignore lists (.eleventyignore still applies).
  eleventyConfig.setUseGitIgnore(false);

  // The feed is a Nunjucks template (src/feed.njk) using the plugin's filters,
  // so that it is summary-only like the Astro feed. The plugin's ready-made RSS
  // template (feedPlugin, 3.1.0) writes <content:encoded> without declaring the
  // content namespace when notes have a summary, which is not well-formed XML.
  eleventyConfig.addPlugin(rssPlugin);
  eleventyConfig.addGlobalData('site', { url: SITE, name: SITE_NAME, summary: SITE_SUMMARY });

  return { dir: { input: 'src', output: 'dist' } };
}
