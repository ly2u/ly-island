import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import { loadConfig } from './src/lib/config.js';

// Fails early, with every problem listed, when island.config.json is wrong.
const island = loadConfig();

export default defineConfig({
  site: island.origin,
  outDir: './dist',
  prerenderConflictBehavior: 'error',
  build: {
    format: 'directory',
    // External files only, so the Content-Security-Policy in public/_headers
    // can forbid inline scripts and styles.
    inlineStylesheets: 'never',
  },
  markdown: {
    // Prism marks code with classes; Shiki would add inline styles.
    syntaxHighlight: 'prism',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
    resolve: {
      // Only the chosen theme is part of the build.
      alias: { '@theme': fileURLToPath(new URL(`./src/themes/${island.theme}`, import.meta.url)) },
    },
  },
  devToolbar: { enabled: false },
});
