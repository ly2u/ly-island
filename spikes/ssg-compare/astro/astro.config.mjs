import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://example.org',
  outDir: './dist',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
