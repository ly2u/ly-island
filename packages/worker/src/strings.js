// Notification text, in the island's first language (Chinese or English).

const zh = {
  notifyTitle: '岛上的新消息',
  digestTitle: '今天岛上的事',
  message: (/** @type {string} */ name, /** @type {string} */ text) => `${name}给你留言：${text}`,
  visit: (/** @type {string} */ name) => `${name}来拜访过`,
  water: (/** @type {string} */ name) => `${name}给你浇了水`,
  follow: (/** @type {string} */ name) => `${name}关注了你`,
  posted: (/** @type {string} */ name, /** @type {string} */ title) => `${name}发了新记录：${title}`,
  keyChanged: (/** @type {string} */ name) => `${name}的密钥变了，确认是本人后再继续接收`,
  deliveryFailed: (/** @type {string} */ name) => `发给${name}的消息没有送达`,
  strangerCount: (/** @type {number} */ n) => `陌生来信里有 ${n} 封新信`,
  more: (/** @type {number} */ n) => `还有 ${n} 条`,
};

/** @type {typeof zh} */
const en = {
  notifyTitle: 'New on your island',
  digestTitle: 'Today on your island',
  message: (name, text) => `${name} left you a message: ${text}`,
  visit: (name) => `${name} visited`,
  water: (name) => `${name} watered your island`,
  follow: (name) => `${name} follows you`,
  posted: (name, title) => `${name} posted: ${title}`,
  keyChanged: (name) => `${name} changed keys; confirm it is really them to keep receiving`,
  deliveryFailed: (name) => `Your message to ${name} was not delivered`,
  strangerCount: (n) => `${n} new letters from strangers`,
  more: (n) => `${n} more`,
};

/** @param {string} language */
export function stringsFor(language) {
  return String(language).toLowerCase().startsWith('zh') ? zh : en;
}

/** Shortens text for a notification line. @param {unknown} text @param {number} [length] */
export function clip(text, length = 80) {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim());
  return chars.length <= length ? chars.join('') : `${chars.slice(0, length).join('')}…`;
}
