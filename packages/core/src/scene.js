// The isometric island as plain shapes, from public data only: the
// appearance seed and colors, the record counts and the unlocked items.
// The same input always gives the same picture, so a neighbor's island can be
// drawn from its manifest without running any of its code.
//
// Shapes are { tag, attributes } with tag one of polygon, ellipse, circle,
// rect; a theme renders them as SVG elements. No markup is produced here.

export const VIEW = Object.freeze({ width: 400, height: 300 });
export const CAPS = Object.freeze({ trees: 30, houses: 12, towers: 6 });
const CENTER = { x: 200, y: 128 };
const SIZES = { seed: 96, growing: 120, flourishing: 144 };
const GREENS = ['#7fb069', '#6a9f58', '#8cbf6d', '#5f8f4e'];
const EARTH = '#9a7650';
const ROCK = '#6f6a7a';
const ROCK_DARK = '#57525f';

/** FNV-1a over the UTF-16 code units. @param {string} text */
export function hash32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, fast and deterministic. @param {number} seed */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes a #rrggbb color toward black (amount < 0) or white (amount > 0). @param {string} hex @param {number} amount */
export function shade(hex, amount) {
  const target = amount < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amount));
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels.map((c) => Math.round(c + (target - c) * k).toString(16).padStart(2, '0')).join('')}`;
}

const r1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;
/** @param {[number, number][]} points */
const pts = (points) => points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');

/**
 * @typedef {{ tag: 'polygon' | 'ellipse' | 'circle' | 'rect', attributes: Record<string, string | number> }} Shape
 */

/** An isometric box standing on (x, y), the front corner. */
function box(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ color) {
  const half = w / 2;
  const quarter = w / 4;
  /** @type {Shape[]} */
  return [
    { tag: 'polygon', attributes: { points: pts([[x - half, y - quarter], [x, y], [x, y - h], [x - half, y - quarter - h]]), fill: shade(color, -0.12) } },
    { tag: 'polygon', attributes: { points: pts([[x, y], [x + half, y - quarter], [x + half, y - quarter - h], [x, y - h]]), fill: shade(color, -0.28) } },
    { tag: 'polygon', attributes: { points: pts([[x - half, y - quarter - h], [x, y - h], [x + half, y - quarter - h], [x, y - 2 * quarter - h]]), fill: shade(color, 0.1) } },
  ];
}

const DRAW = {
  /** @param {number} x @param {number} y @param {() => number} rng */
  tree(x, y, rng) {
    const green = GREENS[Math.floor(rng() * GREENS.length)];
    const height = 9 + rng() * 6;
    /** @type {Shape[]} */
    const shapes = [{ tag: 'rect', attributes: { x: r1(x - 1.2), y: r1(y - 4), width: 2.4, height: 4, fill: '#7a5a3a' } }];
    if (rng() < 0.5) {
      shapes.push({ tag: 'polygon', attributes: { points: pts([[x - 6, y - 3], [x + 6, y - 3], [x, y - 3 - height]]), fill: green } });
      shapes.push({ tag: 'polygon', attributes: { points: pts([[x - 4.5, y - 3 - height * 0.45], [x + 4.5, y - 3 - height * 0.45], [x, y - 5 - height * 1.15]]), fill: shade(green, 0.08) } });
    } else {
      shapes.push({ tag: 'circle', attributes: { cx: r1(x), cy: r1(y - 4 - height * 0.45), r: r1(height * 0.5), fill: green } });
    }
    return shapes;
  },
  /** @param {number} x @param {number} y @param {() => number} rng @param {string[]} colors */
  house(x, y, rng, colors) {
    const w = 14;
    const h = 9 + rng() * 3;
    const roof = colors[0];
    return [
      ...box(x, y, w, h, '#efe6d2'),
      { tag: 'polygon', attributes: { points: pts([[x - w / 2 - 1, y - w / 4 - h], [x, y - h + 1], [x, y - h - 12]]), fill: shade(roof, -0.1) } },
      { tag: 'polygon', attributes: { points: pts([[x, y - h + 1], [x + w / 2 + 1, y - w / 4 - h], [x, y - h - 12]]), fill: shade(roof, -0.3) } },
    ];
  },
  /** @param {number} x @param {number} y @param {() => number} rng @param {string[]} colors @param {boolean} done */
  tower(x, y, rng, colors, done) {
    const h = 22 + rng() * 8;
    /** @type {Shape[]} */
    const shapes = box(x, y, 10, h, '#b9b4c2');
    if (done) {
      shapes.push({ tag: 'rect', attributes: { x: r1(x - 0.6), y: r1(y - 5 - h - 12), width: 1.2, height: 12, fill: '#555555' } });
      shapes.push({ tag: 'polygon', attributes: { points: pts([[x + 0.6, y - 5 - h - 12], [x + 9, y - 5 - h - 9], [x + 0.6, y - 5 - h - 6]]), fill: colors[1] ?? colors[0] } });
    }
    return shapes;
  },
  /** @param {number} x @param {number} y */
  lantern(x, y) {
    return [
      { tag: 'rect', attributes: { x: r1(x - 0.8), y: r1(y - 12), width: 1.6, height: 12, fill: '#4a4a4a' } },
      { tag: 'circle', attributes: { cx: r1(x), cy: r1(y - 13), r: 3, fill: '#ffd966' } },
    ];
  },
  /** @param {number} x @param {number} y */
  windmill(x, y) {
    const hub = [x, y - 20];
    /** @type {Shape[]} */
    const shapes = box(x, y, 11, 18, '#e8dcc8');
    for (const [dx, dy] of [[0, -12], [12, 0], [0, 12], [-12, 0]]) {
      shapes.push({ tag: 'polygon', attributes: { points: pts([[hub[0], hub[1]], [hub[0] + dx + dy * 0.2, hub[1] + dy - dx * 0.2], [hub[0] + dx, hub[1] + dy]]), fill: '#d9d2c5' } });
    }
    return shapes;
  },
  /** @param {number} x @param {number} y @param {() => number} _rng @param {string[]} colors */
  'lighthouse-small'(x, y, _rng, colors) {
    return [
      ...box(x, y, 8, 26, '#f4f1ea'),
      { tag: 'rect', attributes: { x: r1(x - 4), y: r1(y - 16), width: 8, height: 4, fill: colors[1] ?? '#cc4125' } },
      { tag: 'circle', attributes: { cx: r1(x), cy: r1(y - 31), r: 3.2, fill: '#ffe599' } },
    ];
  },
  /** @param {number} x @param {number} y */
  bridge(x, y) {
    return [
      { tag: 'polygon', attributes: { points: pts([[x - 16, y], [x - 8, y - 6], [x + 8, y - 6], [x + 16, y], [x + 12, y], [x + 6, y - 3], [x - 6, y - 3], [x - 12, y]]), fill: '#8a6a4a' } },
    ];
  },
  /** @param {number} x @param {number} y */
  observatory(x, y) {
    return [
      ...box(x, y, 14, 10, '#d8d4de'),
      { tag: 'ellipse', attributes: { cx: r1(x), cy: r1(y - 17), rx: 7, ry: 6, fill: '#9fb4c7' } },
    ];
  },
};

/**
 * @param {object} input
 * @param {string} input.seed
 * @param {string[]} input.colors
 * @param {{ article?: number, note?: number, project?: number }} input.counts public records by kind
 * @param {number} [input.done] finished projects
 * @param {string[]} [input.unlocked]
 * @returns {{ width: number, height: number, size: string, drawn: { trees: number, houses: number, towers: number, decorations: string[] }, background: Shape[], island: Shape[], fog: Shape }}
 */
export function islandScene({ seed, colors, counts, done = 0, unlocked = [] }) {
  const rng = random(hash32(seed));
  const size = unlocked.includes('stage-flourishing') ? 'flourishing' : unlocked.includes('stage-growing') ? 'growing' : 'seed';
  const radius = SIZES[size];
  const { x: cx, y: cy } = CENTER;

  /** @type {Shape[]} */
  const background = [{ tag: 'rect', attributes: { class: 'island-sky', x: 0, y: 0, width: VIEW.width, height: VIEW.height, fill: '#dfeaf5' } }];
  for (let i = 0; i < 7; i += 1) {
    background.push({
      tag: 'ellipse',
      attributes: { class: 'island-cloud', cx: r1(20 + i * 60 + rng() * 20), cy: r1(255 + rng() * 30), rx: r1(45 + rng() * 25), ry: r1(14 + rng() * 8), fill: '#ffffff', opacity: r1(0.7 + rng() * 0.2) },
    });
  }

  const steps = 16;
  /** @type {[number, number][]} */
  const rim = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (2 * Math.PI * i) / steps;
    const r = radius * (0.86 + rng() * 0.14);
    rim.push([cx + r * Math.cos(angle), cy + 0.5 * r * Math.sin(angle)]);
  }
  const depth = radius * 0.16;
  const front = rim.slice(0, steps / 2 + 1); // from the right end, round the front, to the left end
  const lowered = front.map(([x, y]) => /** @type {[number, number]} */ ([x, y + depth]));
  const base = cy + depth;
  const jag = () => (rng() - 0.5) * radius * 0.08;
  /** The rock under the island, from the left end of the rim to the right end. @type {[number, number][]} */
  const under = [
    [cx - radius * 0.72 + jag(), base + radius * 0.14 + jag()],
    [cx - radius * 0.46 + jag(), base + radius * 0.42 + jag()],
    [cx - radius * 0.16 + jag(), base + radius * 0.62 + jag()],
    [cx + (rng() - 0.5) * radius * 0.2, base + radius * 0.82],
    [cx + radius * 0.2 + jag(), base + radius * 0.58 + jag()],
    [cx + radius * 0.5 + jag(), base + radius * 0.36 + jag()],
    [cx + radius * 0.76 + jag(), base + radius * 0.12 + jag()],
  ];
  const highlight = rim.map(([x, y]) => /** @type {[number, number]} */ ([cx + (x - cx) * 0.82, cy - 3 + (y - cy) * 0.78]));

  /** @type {Shape[]} */
  const island = [
    { tag: 'polygon', attributes: { points: pts([...[...lowered].reverse(), ...under]), fill: ROCK } },
    { tag: 'polygon', attributes: { points: pts([[cx, base], ...under.slice(3), ...lowered.slice(0, steps / 4 + 1)]), fill: ROCK_DARK } },
    { tag: 'polygon', attributes: { points: pts([...front, ...[...lowered].reverse()]), fill: EARTH } },
    { tag: 'polygon', attributes: { points: pts(rim), fill: GREENS[0] } },
    { tag: 'polygon', attributes: { points: pts(highlight), fill: shade(GREENS[0], 0.1) } },
  ];

  /** @type {{ x: number, y: number }[]} */
  const taken = [];
  const minDistance = radius * 0.13;
  /** A free spot on the top, or null. @param {number} [reach] share of the radius */
  const spot = (reach = 0.78) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const angle = rng() * 2 * Math.PI;
      const r = Math.sqrt(rng()) * radius * reach;
      const x = cx + r * Math.cos(angle);
      const y = cy + 0.5 * r * Math.sin(angle);
      if (taken.every((p) => Math.hypot(p.x - x, (p.y - y) * 2) >= minDistance)) {
        taken.push({ x, y });
        return { x, y };
      }
    }
    return null;
  };

  /** @type {{ y: number, shapes: Shape[] }[]} */
  const items = [];
  const drawn = { trees: 0, houses: 0, towers: 0, decorations: /** @type {string[]} */ ([]) };
  const wanted = {
    towers: Math.min(counts.project ?? 0, CAPS.towers),
    houses: Math.min(counts.article ?? 0, CAPS.houses),
    trees: Math.min(counts.note ?? 0, CAPS.trees),
  };
  for (const name of /** @type {const} */ (['lantern', 'windmill', 'lighthouse-small', 'bridge', 'observatory'])) {
    if (!unlocked.includes(name)) continue;
    const place = spot(name === 'lighthouse-small' || name === 'bridge' ? 0.9 : 0.7);
    if (!place) continue;
    items.push({ y: place.y, shapes: DRAW[name](place.x, place.y, rng, colors) });
    drawn.decorations.push(name);
  }
  for (let i = 0; i < wanted.towers; i += 1) {
    const place = spot();
    if (!place) break;
    items.push({ y: place.y, shapes: DRAW.tower(place.x, place.y, rng, colors, i < done) });
    drawn.towers += 1;
  }
  for (let i = 0; i < wanted.houses; i += 1) {
    const place = spot();
    if (!place) break;
    items.push({ y: place.y, shapes: DRAW.house(place.x, place.y, rng, colors) });
    drawn.houses += 1;
  }
  for (let i = 0; i < wanted.trees; i += 1) {
    const place = spot(0.85);
    if (!place) break;
    items.push({ y: place.y, shapes: DRAW.tree(place.x, place.y, rng) });
    drawn.trees += 1;
  }
  items.sort((a, b) => a.y - b.y);
  for (const item of items) island.push(...item.shapes);

  const fog = { tag: /** @type {const} */ ('rect'), attributes: { class: 'island-fog', x: 0, y: 0, width: VIEW.width, height: VIEW.height, fill: '#f4f6f8', opacity: 0 } };
  return { width: VIEW.width, height: VIEW.height, size, drawn, background, island, fog };
}
