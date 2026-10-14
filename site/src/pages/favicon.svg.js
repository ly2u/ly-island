// A small island in the island's own colors.

import { island } from '../lib/island.js';

export async function GET() {
  const { colors } = (await island()).config.appearance;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><polygon points="4,14 16,8 28,14 16,20" fill="#7fb069"/><polygon points="4,14 16,20 16,23 4,17" fill="#9a7650"/><polygon points="16,20 28,14 28,17 16,23" fill="#7a5c3c"/><polygon points="6,17 26,17 16,30" fill="#6f6a7a"/><polygon points="13,13 19,13 16,7" fill="${colors[0]}"/></svg>\n`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
}
