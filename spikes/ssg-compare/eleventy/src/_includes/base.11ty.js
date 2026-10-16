import { escape } from './html.js';

export function render({ title, content }) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    <link rel="island" href="/.well-known/island.json" />
    <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
    <style>
      body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #ccc; padding: 0.25rem 0.5rem; }
    </style>
  </head>
  <body>
    <header><a href="/">示例岛</a></header>
    <main>${content}</main>
  </body>
</html>`;
}
