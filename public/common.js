// Shared browser helpers. All DOM is built with textContent/attributes (never
// innerHTML with data), so guest notes or item names can't inject markup.

export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `http_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Retries transient failures (network drop, 5xx, 429) with backoff.
export async function apiRetry(path, opts, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await api(path, opts); } catch (err) {
      const transient = !err.status || err.status >= 500 || err.status === 429;
      if (!transient || i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i + Math.random() * 200));
    }
  }
}

export function moneyFormatter(cfg) {
  const f = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.currency });
  return (cents) => f.format(cents / 100);
}

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

export const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export function minutesSince(ts) { return Math.max(0, Math.floor((Date.now() - ts) / 60000)); }

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// ---------------------------------------------------------------------------
// Language (EN / 中文). One setting shared by every screen on this device.
// ---------------------------------------------------------------------------
export function getLang() {
  return ls.get('lang', navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en');
}
export function setLang(l) {
  ls.set('lang', l);
  document.documentElement.lang = l === 'zh' ? 'zh-Hans' : 'en';
}
// Returns t(key, vars) for a { en: {...}, zh: {...} } dictionary.
export function translator(dict) {
  return (k, vars = {}) => {
    const l = getLang();
    return String(dict[l]?.[k] ?? dict.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
  };
}
// Picks the right language from a {en, zh} object (menu names etc.).
export const pick = (o) => (o ? o[getLang()] || o.en : '');
// Toggle button: shows the language you would switch TO.
export function langButton(onChange, cls = 'btn ghost lang') {
  return h('button', {
    class: cls, type: 'button', 'aria-label': getLang() === 'en' ? '切换到中文' : 'Switch to English',
    onclick: () => { setLang(getLang() === 'en' ? 'zh' : 'en'); onChange(); },
  }, getLang() === 'en' ? '中文' : 'EN');
}
document.documentElement.lang = getLang() === 'zh' ? 'zh-Hans' : 'en';

// Replace an element's content, skipping null/false parts (so a hidden
// section never shows up as the text "null").
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}
