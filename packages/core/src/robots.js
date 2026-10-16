// robots.txt from the manifest's ai.read and ai.train choices.
// Two layers: a Content-Signal line (https://contentsignals.org/) for crawlers
// that read it, and explicit rules for well-known AI crawlers. The crawler
// names were checked on 2026-10-14; new ones appear over time.

export const TRAINING_CRAWLERS = Object.freeze([
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
]);
export const READING_CRAWLERS = Object.freeze([
  'ChatGPT-User',
  'OAI-SearchBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
]);

/** @param {{ read: boolean, train: boolean }} ai */
export function buildRobots(ai) {
  const blocked = [...(ai.train ? [] : TRAINING_CRAWLERS), ...(ai.read ? [] : READING_CRAWLERS)];
  const lines = [
    '# Generated from island.config.json (ai.read, ai.train).',
    'User-agent: *',
    `Content-Signal: search=yes, ai-input=${ai.read ? 'yes' : 'no'}, ai-train=${ai.train ? 'yes' : 'no'}`,
    'Allow: /',
    '',
  ];
  for (const agent of blocked) lines.push(`User-agent: ${agent}`, 'Disallow: /', '');
  return lines.join('\n');
}
