// Activity envelope and per-type rules (protocol sections "活动与签名" and "活动类型").
//
// validateActivity() checks structure and cross-field rules that need no
// outside knowledge. Whether the signature is valid, whether the signing key
// is trusted, and whether a delete is allowed are separate steps
// (sign.js, keyhistory.js, authorship.js).

import { isBase64urlOfLength } from './base64url.js';
import { canonicalBytes } from './canonicalize.js';
import {
  Issues,
  isDateTime,
  isHttpsOrigin,
  isKeyId,
  isLanguageTag,
  isPlainObject,
  isText,
  isUrlOnOrigin,
  originOf,
  parseHttpsUrl,
  timeOf,
} from './util.js';

/** @typedef {import('./util.js').Issue} Issue */

export const DIRECTED_TYPES = Object.freeze(['follow', 'visit', 'message', 'water', 'pickup']);
export const PUBLIC_TYPES = Object.freeze(['post', 'delete', 'bottle', 'move', 'key']);
export const KNOWN_TYPES = Object.freeze([...PUBLIC_TYPES, ...DIRECTED_TYPES]);
export const POST_KINDS = Object.freeze(['article', 'note', 'project', 'album']);
export const REVOKE_REASONS = Object.freeze(['retired', 'compromised']);

export const LIMITS = Object.freeze({
  activityBytes: 16 * 1024,
  recipients: 32,
  title: 200,
  summary: 1000,
  bottleText: 500,
  messageText: 2000,
  pickupText: 500,
  tags: 32,
  tagLength: 64,
});

// Unknown types still need a sane name so they can be logged and skipped.
const TYPE_NAME = /^[a-z][a-z0-9.-]{0,63}$/;

/** @param {unknown} type */
export function isKnownType(type) {
  return typeof type === 'string' && KNOWN_TYPES.includes(type);
}

/** @param {unknown} type */
export function isDirectedType(type) {
  return typeof type === 'string' && DIRECTED_TYPES.includes(type);
}

/**
 * The time an activity counts from when comparing versions: `updated`,
 * or `published` when `updated` is absent.
 * @param {{ published: string, updated?: string }} activity
 */
export function effectiveUpdated(activity) {
  return activity.updated ?? activity.published;
}

/**
 * @param {unknown} activity
 * @returns {{ ok: boolean, known: boolean, directed: boolean, issues: Issue[] }}
 */
export function validateActivity(activity) {
  const issues = new Issues();
  if (!isPlainObject(activity)) {
    issues.add('', 'not-object', 'an activity must be a JSON object');
    return { ok: false, known: false, directed: false, issues: issues.list };
  }

  const { id, type, actor, published, updated, to, object, proof } = activity;

  if (typeof type !== 'string' || !TYPE_NAME.test(type)) {
    issues.add('type', 'invalid-type', 'type must be a lowercase name');
  }

  const actorOk = isHttpsOrigin(actor);
  if (!actorOk) issues.add('actor', 'invalid-actor', 'actor must be a canonical https origin');

  if (parseHttpsUrl(id) === null) {
    issues.add('id', 'invalid-id', 'id must be an https URL');
  } else if (actorOk && originOf(id) !== actor) {
    issues.add('id', 'id-not-on-actor-origin', 'id must be on the actor origin');
  }

  if (!isDateTime(published)) issues.add('published', 'invalid-time', 'published must be an RFC 3339 date-time');
  if (updated !== undefined) {
    if (!isDateTime(updated)) {
      issues.add('updated', 'invalid-time', 'updated must be an RFC 3339 date-time');
    } else if (isDateTime(published) && timeOf(updated) < timeOf(published)) {
      issues.add('updated', 'updated-before-published', 'updated must not be earlier than published');
    }
  }

  checkRecipients(to, issues);

  if (!isPlainObject(object)) issues.add('object', 'invalid-object', 'object must be a JSON object');

  if (!isPlainObject(proof)) {
    issues.add('proof', 'invalid-proof', 'proof must be an object with key and value');
  } else {
    if (actorOk && !isKeyId(proof.key, actor)) {
      issues.add('proof/key', 'invalid-key-id', 'proof.key must be a key id on the actor origin');
    }
    if (!isBase64urlOfLength(proof.value, 64)) {
      issues.add('proof/value', 'invalid-signature-encoding', 'proof.value must be base64url of 64 bytes');
    }
  }

  try {
    if (canonicalBytes(activity).length > LIMITS.activityBytes) {
      issues.add('', 'too-large', `an activity must be at most ${LIMITS.activityBytes} bytes`);
    }
  } catch (error) {
    issues.add('', 'not-canonicalizable', /** @type {Error} */ (error).message);
  }

  const known = isKnownType(type);
  const directed = isDirectedType(type);
  if (known) {
    if (directed && !Array.isArray(to)) {
      issues.add('to', 'directed-needs-recipients', `${type} must list its recipients`);
    }
    if (!directed && to !== 'public') {
      issues.add('to', 'public-type-needs-public', `${type} must be addressed to "public"`);
    }
    if (isPlainObject(object) && actorOk) {
      TYPE_RULES[/** @type {keyof typeof TYPE_RULES} */ (type)](object, activity, issues);
    }
  }

  return { ok: issues.ok, known, directed, issues: issues.list };
}

/** @param {unknown} to @param {Issues} issues */
function checkRecipients(to, issues) {
  if (to === 'public') return;
  if (!Array.isArray(to) || to.length < 1 || to.length > LIMITS.recipients) {
    issues.add('to', 'invalid-recipients', `to must be "public" or 1 to ${LIMITS.recipients} origins`);
    return;
  }
  const seen = new Set();
  to.forEach((recipient, index) => {
    if (!isHttpsOrigin(recipient)) issues.add(`to/${index}`, 'invalid-recipient', 'recipients must be https origins');
    else if (seen.has(recipient)) issues.add(`to/${index}`, 'duplicate-recipient', 'recipients must be unique');
    seen.add(recipient);
  });
}

/**
 * @param {Record<string, any>} object
 * @param {string} field
 * @param {number} max
 * @param {Issues} issues
 * @param {{ required?: boolean, code?: string }} [options]
 */
function checkText(object, field, max, issues, { required = false, code = `invalid-${field}` } = {}) {
  const value = object[field];
  if (value === undefined) {
    if (required) issues.add(`object/${field}`, code, `${field} is required`);
    return;
  }
  if (!isText(value, { min: 1, max })) issues.add(`object/${field}`, code, `${field} must be 1 to ${max} characters`);
}

/**
 * @param {Record<string, any>} object
 * @param {string} field
 * @param {Issues} issues
 * @param {{ required?: boolean, origin?: string }} [options]
 */
function checkUrl(object, field, issues, { required = false, origin } = {}) {
  const value = object[field];
  if (value === undefined) {
    if (required) issues.add(`object/${field}`, `invalid-${field}`, `${field} is required`);
    return;
  }
  if (parseHttpsUrl(value) === null) {
    issues.add(`object/${field}`, `invalid-${field}`, `${field} must be an https URL`);
  } else if (origin !== undefined && !isUrlOnOrigin(value, origin)) {
    issues.add(`object/${field}`, `${field}-not-on-actor-origin`, `${field} must be on the actor origin`);
  }
}

/** @param {Record<string, any>} object @param {Issues} issues */
function checkLanguage(object, issues) {
  if (object.language !== undefined && !isLanguageTag(object.language)) {
    issues.add('object/language', 'invalid-language', 'language must be a language tag');
  }
}

/** @type {Record<string, (object: Record<string, any>, activity: Record<string, any>, issues: Issues) => void>} */
const TYPE_RULES = {
  post(object, activity, issues) {
    checkUrl(object, 'url', issues, { required: true, origin: activity.actor });
    if (!POST_KINDS.includes(object.kind)) {
      issues.add('object/kind', 'invalid-kind', `kind must be one of ${POST_KINDS.join(', ')}`);
    }
    checkText(object, 'title', LIMITS.title, issues);
    checkText(object, 'summary', LIMITS.summary, issues);
    checkLanguage(object, issues);
    if (object.tags !== undefined) {
      if (
        !Array.isArray(object.tags) ||
        object.tags.length > LIMITS.tags ||
        !object.tags.every((/** @type {unknown} */ tag) => isText(tag, { min: 1, max: LIMITS.tagLength }))
      ) {
        issues.add('object/tags', 'invalid-tags', `tags must be at most ${LIMITS.tags} short strings`);
      }
    }
    checkUrl(object, 'image', issues, { origin: activity.actor });
  },

  delete(object, _activity, issues) {
    checkUrl(object, 'of', issues, { required: true });
  },

  bottle(object, activity, issues) {
    checkText(object, 'text', LIMITS.bottleText, issues, { required: true });
    checkUrl(object, 'url', issues, { origin: activity.actor });
    checkLanguage(object, issues);
    if (object.expires !== undefined) {
      if (!isDateTime(object.expires)) {
        issues.add('object/expires', 'invalid-expires', 'expires must be an RFC 3339 date-time');
      } else if (isDateTime(activity.published) && timeOf(object.expires) <= timeOf(activity.published)) {
        issues.add('object/expires', 'expires-before-published', 'expires must be later than published');
      }
    }
  },

  follow() {},

  visit() {},

  message(object, _activity, issues) {
    checkText(object, 'text', LIMITS.messageText, issues, { required: true });
    checkUrl(object, 'inReplyTo', issues);
    if (object.public !== undefined && typeof object.public !== 'boolean') {
      issues.add('object/public', 'invalid-public', 'public must be true or false');
    }
  },

  water(object, _activity, issues) {
    checkUrl(object, 'target', issues);
  },

  pickup(object, activity, issues) {
    checkUrl(object, 'of', issues, { required: true });
    checkText(object, 'text', LIMITS.pickupText, issues);
    const to = activity.to;
    if (Array.isArray(to) && to.length !== 1) {
      issues.add('to', 'pickup-needs-one-recipient', 'a pickup goes to exactly one island');
    } else if (Array.isArray(to) && parseHttpsUrl(object.of) !== null && originOf(object.of) !== to[0]) {
      issues.add('object/of', 'pickup-not-to-author', 'a pickup must be sent to the island that threw the bottle');
    }
  },

  move(object, activity, issues) {
    if (!isHttpsOrigin(object.to)) {
      issues.add('object/to', 'invalid-move-target', 'to must be a canonical https origin');
    } else if (object.to === activity.actor) {
      issues.add('object/to', 'move-to-self', 'an island cannot move to itself');
    }
  },

  key(object, activity, issues) {
    const { add, revoke, reason } = object;
    if (add === undefined && revoke === undefined) {
      issues.add('object', 'empty-key-change', 'a key activity must add or revoke a key');
    }
    if (add !== undefined) {
      if (
        !isPlainObject(add) ||
        !isKeyId(add.id, activity.actor) ||
        add.type !== 'Ed25519' ||
        !isBase64urlOfLength(add.publicKey, 32)
      ) {
        issues.add('object/add', 'invalid-key', 'add must be { id, type: "Ed25519", publicKey }');
      } else if (isPlainObject(activity.proof) && activity.proof.key === add.id) {
        issues.add('proof/key', 'self-signed-key', 'a new key cannot sign its own introduction');
      }
    }
    if (revoke !== undefined) {
      if (!isKeyId(revoke, activity.actor)) {
        issues.add('object/revoke', 'invalid-revoke', 'revoke must be a key id on the actor origin');
      } else if (isPlainObject(add) && add.id === revoke) {
        issues.add('object/revoke', 'invalid-revoke', 'a key cannot be added and revoked at once');
      }
    }
    if (reason !== undefined) {
      if (revoke === undefined) {
        issues.add('object/reason', 'reason-without-revoke', 'reason only applies to a revocation');
      } else if (!REVOKE_REASONS.includes(reason)) {
        issues.add('object/reason', 'invalid-reason', `reason must be one of ${REVOKE_REASONS.join(', ')}`);
      }
    }
  },
};
