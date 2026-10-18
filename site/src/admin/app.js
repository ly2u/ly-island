// The owner's pages (/island/admin/), behind Cloudflare Access.
// Everything shown comes from /island/api. Text from other islands is
// untrusted: it is only ever set with textContent, never as HTML.

const root = /** @type {HTMLElement} */ (document.querySelector('[data-admin]'));
const t = JSON.parse(root.dataset.strings ?? '{}');
const view = /** @type {HTMLElement} */ (document.querySelector('[data-view]'));
const status = /** @type {HTMLElement} */ (document.querySelector('[data-status]'));
const lang = document.documentElement.lang || 'en';

/** @param {string} path @param {unknown} [body] */
async function api(path, body) {
  const response = await fetch(`/island/api${path}`, body === undefined
    ? { headers: { accept: 'application/json' } }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.reason ?? data.error ?? `HTTP ${response.status}`);
  return data;
}

/**
 * A tiny element builder: attributes are set as properties or attributes,
 * children are nodes or text (as text, never HTML).
 * @param {string} tag @param {Record<string, any>} [attributes] @param {...(Node | string | null | undefined | false)} children
 */
function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'class') element.className = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) element.append(child);
  return element;
}

/** @param {string} message @param {boolean} [error] */
function say(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

/**
 * Runs an action and reports how it went.
 * @param {() => Promise<any>} action @param {string | ((result: any) => string)} [done]
 */
async function act(action, done = t.done) {
  try {
    say(t.working);
    const result = await action();
    say(typeof done === 'function' ? done(result) : done);
    await render();
  } catch (error) {
    say(`${t.failed}: ${/** @type {Error} */ (error).message}`, true);
  }
}

/** An external https link, or plain text when the address is not https. @param {string} href @param {string} text */
function link(href, text) {
  return /^https:\/\//.test(href) ? h('a', { href, rel: 'noopener noreferrer' }, text) : document.createTextNode(text);
}

/** @param {string} iso */
const when = (iso) => h('time', { datetime: iso }, new Date(iso).toLocaleString(lang));

/** @param {Record<string, string>} params */
const composeLink = (params) => `#compose?${new URLSearchParams(params)}`;

const views = {
  async inbox(/** @type {URLSearchParams} */ params) {
    const folder = params.get('folder') === 'strangers' ? 'strangers' : 'inbox';
    const { items } = await api(`/inbox?folder=${folder}`);
    return [
      h('p', { class: 'tabs' }, h('a', { href: '#inbox', 'aria-current': folder === 'inbox' ? 'page' : null }, t.inbox), ' ', h('a', { href: '#inbox?folder=strangers', 'aria-current': folder === 'strangers' ? 'page' : null }, t.strangers)),
      items.length === 0 ? h('p', { class: 'empty' }, t.nothing) : h('ul', { class: 'items' }, ...items.map((/** @type {any} */ item) => h('li', { class: item.read ? 'read' : 'unread' },
        h('p', { class: 'meta' }, link(item.actor, item.name), ' · ', t.types[item.type] ?? item.type, ' · ', when(item.received)),
        item.type === 'message' ? h('p', { class: 'text' }, item.activity.object.text) : null,
        item.activity.object.inReplyTo ? h('p', { class: 'meta' }, t.inReplyTo, ' ', link(item.activity.object.inReplyTo, item.activity.object.inReplyTo)) : null,
        h('p', { class: 'actions' },
          h('a', { href: composeLink({ type: 'message', to: item.actor }) }, t.reply), ' ',
          h('button', { type: 'button', onclick: () => act(() => api('/send', { type: 'visit', to: item.actor })) }, t.visit), ' ',
          h('button', { type: 'button', onclick: () => act(() => api('/send', { type: 'water', to: item.actor })) }, t.water), ' ',
          folder === 'strangers' ? h('button', { type: 'button', onclick: () => act(() => api('/islands', { origin: item.actor, action: 'allow' })) }, t.allow) : null, ' ',
          h('button', { type: 'button', onclick: () => act(() => api('/islands', { origin: item.actor, action: 'block' })) }, t.block), ' ',
          item.read ? null : h('button', { type: 'button', onclick: () => act(() => api('/inbox/read', { actor: item.actor, id: item.id })) }, t.markRead),
        ),
      ))),
    ];
  },

  async feed() {
    const { items } = await api('/feed');
    return [
      h('p', {}, h('button', { type: 'button', onclick: () => act(() => api('/poll', {}), t.refreshed) }, t.refresh)),
      items.length === 0 ? h('p', { class: 'empty' }, t.nothing) : h('ul', { class: 'items' }, ...items.map((/** @type {any} */ item) => {
        const object = item.activity.object;
        return h('li', {},
          h('p', { class: 'meta' }, link(item.actor, item.name), ' · ', when(item.activity.published)),
          h('p', { class: 'title' }, link(object.url, object.title ?? object.summary ?? object.url)),
          object.summary && object.title ? h('p', { class: 'text' }, object.summary) : null,
          h('p', { class: 'actions' },
            h('a', { href: composeLink({ type: 'message', to: item.actor, inReplyTo: object.url }) }, t.reply), ' ',
            h('button', { type: 'button', onclick: () => act(() => api('/send', { type: 'water', to: item.actor, target: object.url })) }, t.water),
          ));
      })),
    ];
  },

  async islands() {
    const { items } = await api('/islands');
    const address = h('input', { type: 'url', name: 'origin', required: true, placeholder: 'https://', autocomplete: 'url' });
    return [
      h('form', { class: 'inline', onsubmit: (/** @type {SubmitEvent} */ event) => { event.preventDefault(); act(() => api('/follow', { origin: /** @type {HTMLInputElement} */ (address).value.trim().replace(/\/+$/, '') })); } },
        h('label', {}, t.followAddress, ' ', address), ' ', h('button', { type: 'submit' }, t.follow)),
      items.length === 0 ? h('p', { class: 'empty' }, t.nothing) : h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, t.island), h('th', {}, t.relation), h('th', {}, ''))),
        h('tbody', {}, ...items.map((/** @type {any} */ item) => h('tr', {},
          h('td', {}, link(item.origin, item.name)),
          h('td', {}, [item.publicFriend ? t.publicFriend : item.following && t.following, item.follower && t.follower, item.allowed && t.allowed, item.blocked && t.blocked, item.paused && t.paused].filter(Boolean).join(' · ')),
          h('td', { class: 'actions' },
            item.following && !item.publicFriend ? h('button', { type: 'button', onclick: () => act(() => api('/unfollow', { origin: item.origin })) }, t.unfollow) : null,
            !item.following ? h('button', { type: 'button', onclick: () => act(() => api('/follow', { origin: item.origin })) }, t.follow) : null, ' ',
            h('button', { type: 'button', onclick: () => act(() => api('/islands', { origin: item.origin, action: item.blocked ? 'unblock' : 'block' })) }, item.blocked ? t.unblock : t.block), ' ',
            item.paused ? h('button', { type: 'button', onclick: () => act(() => api('/islands', { origin: item.origin, action: 'retrust' }),
              (result) => t.retrusted.replace('{released}', String(result.released ?? 0)).replace('{expired}', String(result.expired ?? 0))) }, t.retrust) : null,
          ),
        ))),
      ),
    ];
  },

  async compose(/** @type {URLSearchParams} */ params) {
    const types = ['message', 'visit', 'water', 'follow'];
    const wanted = types.includes(params.get('type') ?? '') ? params.get('type') : 'message';
    const type = /** @type {HTMLSelectElement} */ (h('select', { name: 'type' }, ...types.map((value) => h('option', { value, selected: value === wanted }, t.types[value]))));
    const to = /** @type {HTMLInputElement} */ (h('input', { type: 'url', name: 'to', required: true, value: params.get('to') ?? '' }));
    const text = /** @type {HTMLTextAreaElement} */ (h('textarea', { name: 'text', rows: 6, maxlength: 2000 }));
    text.value = params.get('text') ?? '';
    const inReplyTo = /** @type {HTMLInputElement} */ (h('input', { type: 'url', name: 'inReplyTo', value: params.get('inReplyTo') ?? '' }));
    const consent = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', name: 'public' }));
    const returnTo = params.get('returnTo') ?? '';
    const messageOnly = [h('label', {}, t.message, ' ', text), h('label', { class: 'check' }, consent, ' ', t.publicConsent)];
    const about = h('label', {}, t.inReplyTo, ' ', inReplyTo);
    const show = () => {
      for (const field of messageOnly) field.hidden = type.value !== 'message';
      about.hidden = type.value !== 'message' && type.value !== 'water';
    };
    type.addEventListener('change', show);
    show();
    const send = async () => {
      const target = to.value.trim().replace(/\/+$/, '');
      if (type.value === 'message' && text.value.trim() === '') throw new Error(t.needText);
      const result = type.value === 'follow'
        ? await api('/follow', { origin: target })
        : await api('/send', {
          type: type.value,
          to: target,
          ...(type.value === 'message' ? { text: text.value, inReplyTo: inReplyTo.value, public: consent.checked } : {}),
          ...(type.value === 'water' && inReplyTo.value ? { target: inReplyTo.value } : {}),
          ...(params.get('draft') ? { draft: Number(params.get('draft')) } : {}),
        });
      if (result.status !== 'delivered') throw new Error(`${t.statuses[result.status] ?? result.status}${result.reason ? ` (${result.reason})` : ''}`);
      // Back to the page the visitor came from, only on the recipient's own island.
      let back = null;
      try {
        back = returnTo && new URL(returnTo).origin === target ? new URL(returnTo) : null;
      } catch {
        back = null;
      }
      if (back) location.assign(`${back.origin}${back.pathname}${back.search}#island-sent`);
      // Show what was sent instead of the filled form, so it is not sent twice.
      else history.pushState(null, '', '#sent');
    };
    return [
      h('form', { class: 'stack', onsubmit: (/** @type {SubmitEvent} */ event) => { event.preventDefault(); act(send, t.sent); } },
        h('label', {}, t.kind, ' ', type),
        h('label', {}, t.to, ' ', to),
        ...messageOnly,
        about,
        h('p', {}, h('button', { type: 'submit' }, t.send))),
    ];
  },

  async sent() {
    const { items } = await api('/sent');
    return items.length === 0 ? [h('p', { class: 'empty' }, t.nothing)] : [h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, t.to), h('th', {}, t.kind), h('th', {}, t.status), h('th', {}, ''))),
      h('tbody', {}, ...items.map((/** @type {any} */ item) => h('tr', {},
        h('td', {}, link(item.recipient, item.recipient)), h('td', {}, t.types[item.type] ?? item.type),
        h('td', {}, t.statuses[item.status] ?? item.status, item.last_error && item.status !== 'resent' ? ` (${item.last_error})` : ''),
        h('td', { class: 'actions' }, when(item.created), ' ',
          ['expired', 'failed'].includes(item.status) ? h('button', { type: 'button', onclick: (/** @type {MouseEvent} */ event) => {
            /** @type {HTMLButtonElement} */ (event.currentTarget).disabled = true;
            // The server sends it again only once; a second click is answered "already-resent".
            act(() => api('/resend', { id: item.id }).catch((error) => {
              if (error.message !== 'already-resent') throw error;
            }), t.resent);
          } }, t.resend) : null)))))];
  },

  async drafts() {
    const { items } = await api('/drafts');
    return items.length === 0 ? [h('p', { class: 'empty' }, t.nothing)] : [h('ul', { class: 'items' }, ...items.map((/** @type {any} */ item) => h('li', {},
      h('p', { class: 'meta' }, t.draftBy, ' ', item.by, ' → ', link(item.data.to, item.data.to)),
      h('p', { class: 'text' }, item.data.text ?? ''),
      h('p', { class: 'actions' },
        h('a', { href: composeLink({ type: item.type, to: item.data.to, inReplyTo: item.data.inReplyTo ?? '', text: item.data.text ?? '', draft: String(item.id) }) }, t.review), ' ',
        h('button', { type: 'button', onclick: () => act(() => api('/drafts/delete', { id: item.id })) }, t.remove)))))];
  },

  async settings() {
    const [me, tokens] = await Promise.all([api('/me'), api('/tokens')]);
    const scope = /** @type {HTMLSelectElement} */ (h('select', {}, h('option', { value: 'read' }, t.scopeRead), h('option', { value: 'draft' }, t.scopeDraft)));
    const label = /** @type {HTMLInputElement} */ (h('input', { type: 'text', maxlength: 64, value: 'AI' }));
    const shown = h('p', { class: 'new-token' });
    return [
      h('h2', {}, t.service),
      h('ul', {}, h('li', {}, me.canSend ? t.canSend : `${t.cannotSend}: ${me.signingProblem}`), h('li', {}, `${t.channels}: ${me.channels.join(', ') || t.none}`)),
      h('p', {}, h('button', { type: 'button', onclick: () => act(() => api('/notify/test', {}), t.testSent) }, t.testNotify), ' ', h('a', { href: '/island/api/export', download: '' }, t.export)),
      h('h2', {}, t.tokens),
      h('form', { class: 'inline', onsubmit: async (/** @type {SubmitEvent} */ event) => {
        event.preventDefault();
        try {
          const created = await api('/tokens', { scope: scope.value, label: label.value });
          shown.textContent = `${t.tokenOnce} ${created.token}`;
        } catch (error) {
          say(`${t.failed}: ${/** @type {Error} */ (error).message}`, true);
        }
      } }, scope, ' ', label, ' ', h('button', { type: 'submit' }, t.createToken)),
      shown,
      h('ul', {}, ...tokens.items.map((/** @type {any} */ token) => h('li', {}, `${token.label} · ${token.scope}${token.revoked ? ` · ${t.revoked}` : ''} `,
        token.revoked ? null : h('button', { type: 'button', onclick: () => act(() => api('/tokens/revoke', { hash: token.hash })) }, t.revoke)))),
    ];
  },
};

async function render() {
  const [name, query = ''] = location.hash.slice(1).split('?');
  const key = /** @type {keyof typeof views} */ (Object.hasOwn(views, name) ? name : 'inbox');
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.getAttribute('data-tab') === key) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  try {
    view.replaceChildren(...(await views[key](new URLSearchParams(query))));
  } catch (error) {
    view.replaceChildren(h('p', { class: 'error' }, `${t.failed}: ${/** @type {Error} */ (error).message}`));
  }
  view.dataset.shown = key; // for the browser check: this view is ready
}

addEventListener('hashchange', () => {
  say('');
  render();
});
render();
