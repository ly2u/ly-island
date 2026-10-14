// The island's own colors as CSS variables, so that pages need no inline styles.

import { island } from '../lib/island.js';

export async function GET() {
  const { colors } = (await island()).config.appearance;
  const css = `:root {\n  --island-accent: ${colors[0]};\n  --island-accent-2: ${colors[1] ?? colors[0]};\n}\n`;
  return new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8' } });
}
