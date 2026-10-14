import { escape } from './html.js';

const STYLE = `<style>
  .island { width: 100%; max-width: 32rem; }
  .island .ground { fill: #cfe3c4; stroke: #7a9c6a; }
  .island .house { fill: #e8b07a; }
  .island .tree { fill: #4f8a4b; }
  .island .tower { fill: #8aa0b8; }
</style>`;

/** The island picture, drawn from counts. Same shapes as the Astro component. */
export function island({ trees, houses, towers }) {
  const repeat = (count, draw) => Array.from({ length: count }, (_, i) => draw(i)).join('');
  const label = escape(`岛上有 ${houses} 座房子、${trees} 棵树、${towers} 座塔`);
  return `${STYLE}<svg class="island" viewBox="0 0 320 200" role="img" aria-label="${label}">
  <polygon class="ground" points="160,60 300,120 160,180 20,120" />
  ${repeat(houses, (i) => `<rect class="house" x="${110 + i * 30}" y="95" width="20" height="20" />`)}
  ${repeat(trees, (i) => `<circle class="tree" cx="${80 + i * 25}" cy="125" r="9" />`)}
  ${repeat(towers, (i) => `<rect class="tower" x="${210 + i * 20}" y="70" width="10" height="45" />`)}
</svg>`;
}
