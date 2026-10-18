// The Cloudflare Worker for this island: static pages come from the assets;
// only the island service's routes (see wrangler.jsonc, run_worker_first)
// and the cron reach this code. Interaction data lives in D1 (ISLAND_DB).
// The island's time zone arrives as the ISLAND_TIME_ZONE variable, which
// scripts/wrangler-config.mjs takes from the settings.

import { createIsland } from '../../packages/worker/src/index.js';
import { d1Store } from '../../packages/worker/src/store-d1.js';
import notify from '../island/notify.json';

const island = createIsland({
  storeFor: (env) => d1Store(env.ISLAND_DB),
  notify,
});

export default {
  fetch: (request, env, ctx) => island.fetch(request, env, ctx),
  scheduled: (controller, env, ctx) => island.scheduled(controller, env, ctx),
};
