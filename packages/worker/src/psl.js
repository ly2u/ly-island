// Registrable domains (eTLD+1) from the Public Suffix List, for rate limits
// that add up all islands under one domain. Rules are parsed on first use.

import { RULES } from './psl-data.js';

/** @type {{ exact: Set<string>, wildcard: Set<string>, exception: Set<string> } | null} */
let parsed = null;

function rules() {
  if (parsed) return parsed;
  parsed = { exact: new Set(), wildcard: new Set(), exception: new Set() };
  for (const rule of RULES.split('\n')) {
    if (rule.startsWith('!')) parsed.exception.add(rule.slice(1));
    else if (rule.startsWith('*.')) parsed.wildcard.add(rule.slice(2));
    else parsed.exact.add(rule);
  }
  return parsed;
}

/**
 * The public suffix of a host name (the PSL algorithm, with "*" as the
 * default rule).
 * @param {string} host lowercase ASCII
 */
export function publicSuffix(host) {
  const { exact, wildcard, exception } = rules();
  const labels = host.split('.');
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    if (exception.has(candidate)) return labels.slice(i + 1).join('.');
    // A wildcard here means a suffix one label longer than an exact rule here.
    if (i > 0 && wildcard.has(candidate)) return labels.slice(i - 1).join('.');
    if (exact.has(candidate)) return candidate;
  }
  return labels[labels.length - 1];
}

/**
 * The registrable domain: the public suffix plus one label. A host that is
 * itself a public suffix stands for itself.
 * @param {string} host
 */
export function registrableDomain(host) {
  const suffix = publicSuffix(host);
  if (suffix === host) return host;
  const rest = host.slice(0, host.length - suffix.length - 1).split('.');
  return `${rest[rest.length - 1]}.${suffix}`;
}
