import { $, h, api, toast, ls, minutesSince, translator, pick, getLang, langButton } from './common.js';

const t = translator({
  en: {
    title: 'Kitchen', live: 'Live', reconnecting: 'Reconnecting…', connecting: 'Connecting…',
    soundOn: '🔔 Sound on', soundOff: '🔕 Sound off', admin: 'Admin', signOut: 'Sign out',
    colNew: 'New', colPreparing: 'Preparing', colReady: 'Ready to serve',
    start: 'Start cooking', markReady: 'Mark ready', served: 'Served', cancel: 'Cancel', back: 'Move back one step',
    nothing: 'Nothing here', done: 'Done', minutesTitle: 'Minutes since ordered',
    cancelConfirm: 'Cancel order #{no} for {table}?', conflict: 'Order was already updated on another screen.', failed: 'Failed: {msg}',
    waiter: '🙋 Call waiter', bill: '🧾 Bill please', water: '💧 Water',
  },
  zh: {
    title: '厨房', live: '在线', reconnecting: '重新连接中…', connecting: '连接中…',
    soundOn: '🔔 提示音开', soundOff: '🔕 提示音关', admin: '管理后台', signOut: '退出',
    colNew: '新订单', colPreparing: '制作中', colReady: '待上菜',
    start: '开始制作', markReady: '完成', served: '已上菜', cancel: '取消', back: '退回上一步',
    nothing: '暂无订单', done: '已处理', minutesTitle: '下单后经过的分钟数',
    cancelConfirm: '确定取消 {table} 的订单 #{no}？', conflict: '该订单已在其他屏幕更新。', failed: '操作失败：{msg}',
    waiter: '🙋 呼叫服务员', bill: '🧾 结账', water: '💧 要水',
  },
});

const COLS = [
  { status: 'new', title: 'colNew', action: 'start', next: 'preparing' },
  { status: 'preparing', title: 'colPreparing', action: 'markReady', next: 'ready' },
  { status: 'ready', title: 'colReady', action: 'served', next: 'served' },
];
const PREV = { preparing: 'new', ready: 'preparing' };
const pad = (n) => String(n).padStart(3, '0');
const other = (o) => (o ? (getLang() === 'zh' ? o.en : o.zh) : '');

const S = { me: null, orders: new Map(), requests: new Map(), sound: ls.get('kds-sound', false), online: false };
let audio;

async function boot() {
  try { S.me = (await api('/api/auth/me')).user; }
  catch { location.replace('/login?next=/kitchen'); return; }
  renderShell();
  await resync();
  connect();
  setInterval(renderBoard, 15_000); // refresh ticket ages
  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }, 1000);
}

async function resync() {
  const [{ orders }, { requests }] = await Promise.all([api('/api/staff/orders'), api('/api/staff/requests')]);
  S.orders = new Map(orders.map((o) => [o.id, o]));
  S.requests = new Map(requests.map((r) => [r.id, r]));
  renderBoard();
  renderRequests();
}

function connect() {
  const es = new EventSource('/api/staff/stream');
  let first = true;
  es.addEventListener('open', () => { setOnline(true); if (!first) resync().catch(() => {}); first = false; });
  es.addEventListener('error', () => setOnline(false));
  es.addEventListener('order', (e) => {
    const o = JSON.parse(e.data);
    const isNew = !S.orders.has(o.id) && o.status === 'new';
    if (['new', 'preparing', 'ready'].includes(o.status)) S.orders.set(o.id, o); else S.orders.delete(o.id);
    renderBoard();
    if (isNew) { chime(); flash(o.id); }
  });
  es.addEventListener('request', (e) => {
    const r = JSON.parse(e.data);
    if (r.resolvedAt) S.requests.delete(r.id); else { S.requests.set(r.id, r); chime(2); }
    renderRequests();
  });
}

function setOnline(on) {
  S.online = on;
  const dot = $('#conn');
  dot.className = `conn ${on ? 'on' : 'off'}`;
  dot.textContent = on ? t('live') : t('reconnecting');
}

function rerender() {
  renderShell();
  setOnline(S.online);
  renderBoard();
  renderRequests();
}

function renderShell() {
  document.title = t('title');
  $('#app').replaceChildren(
    h('header', { class: 'kds-top' },
      h('h1', {}, t('title')),
      h('span', { id: 'clock', class: 'clock' }),
      h('span', { id: 'conn', class: 'conn off' }, t('connecting')),
      h('div', { class: 'spacer' }),
      langButton(rerender),
      h('button', { id: 'soundBtn', class: 'btn ghost', onclick: toggleSound }, S.sound ? t('soundOn') : t('soundOff')),
      S.me.role === 'admin' ? h('a', { class: 'btn ghost', href: '/admin' }, t('admin')) : null,
      h('button', { class: 'btn ghost', onclick: logout }, t('signOut'))),
    h('section', { id: 'requests', class: 'requests', 'aria-live': 'polite' }),
    h('main', { id: 'board', class: 'board' }),
  );
}

function renderRequests() {
  const list = [...S.requests.values()].sort((a, b) => a.createdAt - b.createdAt);
  $('#requests').replaceChildren(...list.map((r) => h('div', { class: `req ${r.type}` },
    h('strong', {}, tableName(r.tableName)), h('span', {}, t(r.type)), h('span', { class: 'age' }, `${minutesSince(r.createdAt)}m`),
    h('button', { class: 'btn small', onclick: () => api(`/api/staff/requests/${r.id}/resolve`, { method: 'POST' }).catch((e) => toast(e.message, 'err')) }, t('done')))));
}

// "Table 5" → "5号桌" in Chinese mode; custom names are left alone.
function tableName(name) {
  const m = /^Table\s+(\S+)$/i.exec(name);
  return getLang() === 'zh' && m ? `${m[1]}号桌` : name;
}

function renderBoard() {
  const orders = [...S.orders.values()].sort((a, b) => a.createdAt - b.createdAt);
  $('#board').replaceChildren(...COLS.map((c) => {
    const list = orders.filter((o) => o.status === c.status);
    return h('section', { class: `col ${c.status}`, 'aria-label': t(c.title) },
      h('h2', {}, t(c.title), h('span', { class: 'count' }, String(list.length))),
      h('div', { class: 'tickets' }, list.length ? list.map((o) => ticket(o, c)) : h('p', { class: 'none' }, t('nothing'))));
  }));
}

function ticket(o, col) {
  const age = minutesSince(o.createdAt);
  const urgency = o.status === 'ready' ? '' : age >= 15 ? 'late' : age >= 10 ? 'warn' : '';
  return h('article', { class: `ticket ${urgency}`, id: `o-${o.id}` },
    h('header', {},
      h('span', { class: 'tno' }, `#${pad(o.no)}`),
      h('span', { class: 'ttable' }, tableName(o.tableName)),
      h('span', { class: 'tage', title: t('minutesTitle') }, `${age}m`)),
    h('ul', {}, o.items.map((l) => h('li', {},
      h('span', { class: 'q' }, `${l.qty}×`),
      h('div', {},
        h('div', { class: 'n' }, pick(l.name), h('span', { class: 'zh' }, ` ${other(l.name) || ''}`)),
        l.options.length ? h('div', { class: 'o' }, l.options.map((x) => pick(x.name)).join(' · ')) : null,
        l.note ? h('div', { class: 'note' }, `⚠ ${l.note}`) : null)))),
    h('footer', {},
      PREV[o.status] ? h('button', { class: 'btn ghost small', title: t('back'), 'aria-label': t('back'), onclick: () => move(o, PREV[o.status]) }, '↶') : null,
      o.status === 'new' ? h('button', { class: 'btn ghost small', onclick: () => { if (confirm(t('cancelConfirm', { no: pad(o.no), table: tableName(o.tableName) }))) move(o, 'cancelled'); } }, t('cancel')) : null,
      h('button', { class: `btn primary act-${col.next}`, onclick: () => move(o, col.next) }, t(col.action))));
}

async function move(o, status) {
  try {
    const { order } = await api(`/api/staff/orders/${o.id}`, { method: 'PATCH', body: { status } });
    if (['new', 'preparing', 'ready'].includes(order.status)) S.orders.set(order.id, order); else S.orders.delete(order.id);
    renderBoard();
  } catch (e) {
    if (e.status === 401) location.replace('/login?next=/kitchen');
    toast(e.status === 409 ? t('conflict') : t('failed', { msg: e.message }), 'err');
    resync().catch(() => {});
  }
}

function flash(id) {
  requestAnimationFrame(() => document.getElementById(`o-${id}`)?.classList.add('flash'));
}

function toggleSound() {
  S.sound = !S.sound;
  ls.set('kds-sound', S.sound);
  $('#soundBtn').textContent = S.sound ? t('soundOn') : t('soundOff');
  if (S.sound) chime();
}

function chime(times = 1) {
  if (!S.sound) return;
  try {
    audio ||= new AudioContext();
    for (let i = 0; i < times; i++) {
      const t0 = audio.currentTime + i * 0.35;
      for (const [f, dt] of [[880, 0], [1320, 0.12]]) {
        const osc = audio.createOscillator();
        const g = audio.createGain();
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.25);
        osc.connect(g).connect(audio.destination);
        osc.start(t0 + dt);
        osc.stop(t0 + dt + 0.3);
      }
    }
  } catch {}
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.replace('/login?next=/kitchen');
}

boot();
