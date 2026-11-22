import { $, h, api, moneyFormatter, toast, translator, pick, getLang, langButton } from './common.js';

const t = translator({
  en: {
    title: 'Admin console', dashboard: 'Dashboard', menu: 'Menu', tables: 'Tables & QR', orders: 'Orders',
    kitchen: 'Kitchen', signOut: 'Sign out',
    revenue: 'Revenue today', orderCount: 'Orders', avgTicket: 'Avg. ticket', avgPrep: 'Avg. prep time', inKitchen: 'In the kitchen', openTables: 'Open tables',
    min: '{n} min', topItems: 'Top items today', byHour: 'Orders by hour', byHourAria: 'Orders per hour today', hourTitle: '{h}:00 — {n} orders',
    noOrders: 'No orders yet today.',
    menuHint: 'Changes are pushed to every guest’s phone instantly. Mark items sold out when you run out.',
    item: 'Item', price: 'Price', available: 'Available', priceOf: 'Price of {name}', availableOf: '{name} available',
    invalidPrice: 'Invalid price', backOn: '{name} is back on the menu', soldOut: '{name} marked sold out',
    tablesHint: 'Print each QR and stick it on the table. “Rotate” invalidates a code that was photographed or leaked; “Close bill” ends the table’s session after payment.',
    newTablePh: 'e.g. Patio 3', newTableAria: 'New table name', addTable: '+ Add table', printAll: 'Print all',
    qrAlt: 'QR code for {name}', occupied: 'Occupied · {n} order(s)', free: 'Available', open: 'Open', closeBill: 'Close bill', rotate: 'Rotate',
    closeConfirm: 'Close the bill for {name}? Its orders will be marked paid.',
    rotateConfirm: 'Rotate the QR for {name}? The printed code stops working and must be re-printed.',
    done: 'Done', todaysOrders: 'Today’s orders ({n})',
    colNo: '#', colTime: 'Time', colTable: 'Table', colItems: 'Items', colTotal: 'Total', colStatus: 'Status', colPaid: 'Paid',
    s_new: 'New', s_preparing: 'Preparing', s_ready: 'Ready', s_served: 'Served', s_cancelled: 'Cancelled',
  },
  zh: {
    title: '管理后台', dashboard: '概览', menu: '菜单', tables: '餐桌与二维码', orders: '订单',
    kitchen: '厨房', signOut: '退出',
    revenue: '今日营业额', orderCount: '订单数', avgTicket: '平均客单价', avgPrep: '平均出餐时间', inKitchen: '制作中', openTables: '就餐中餐桌',
    min: '{n} 分钟', topItems: '今日热销', byHour: '每小时订单', byHourAria: '今日每小时订单数', hourTitle: '{h}:00 — {n} 单',
    noOrders: '今天还没有订单。',
    menuHint: '修改会立即同步到所有顾客的手机。食材用完时请标记为售完。',
    item: '菜品', price: '价格', available: '供应中', priceOf: '{name} 的价格', availableOf: '{name} 是否供应',
    invalidPrice: '价格无效', backOn: '{name} 已恢复供应', soldOut: '{name} 已标记售完',
    tablesHint: '打印二维码并贴在餐桌上。“更换”会让被拍照或外泄的旧二维码失效；“结账”会在付款后结束该桌的用餐。',
    newTablePh: '例如：户外 3', newTableAria: '新餐桌名称', addTable: '+ 添加餐桌', printAll: '全部打印',
    qrAlt: '{name} 的二维码', occupied: '就餐中 · {n} 单', free: '空闲', open: '打开', closeBill: '结账', rotate: '更换',
    closeConfirm: '确定为 {name} 结账？该桌订单将标记为已付款。',
    rotateConfirm: '确定更换 {name} 的二维码？已打印的旧二维码将失效，需要重新打印。',
    done: '已完成', todaysOrders: '今日订单（{n}）',
    colNo: '#', colTime: '时间', colTable: '餐桌', colItems: '菜品', colTotal: '金额', colStatus: '状态', colPaid: '已付款',
    s_new: '新订单', s_preparing: '制作中', s_ready: '已完成', s_served: '已上菜', s_cancelled: '已取消',
  },
});

const TABS = ['dashboard', 'menu', 'tables', 'orders'];
const S = { me: null, cfg: null, tab: location.hash.slice(1) || 'dashboard' };
let money;
const pad = (n) => String(n).padStart(3, '0');
// "Table 5" → "5号桌" in Chinese mode; custom names are left alone.
const tableName = (name) => { const m = /^Table\s+(\S+)$/i.exec(name); return getLang() === 'zh' && m ? `${m[1]}号桌` : name; };

async function boot() {
  try { S.me = (await api('/api/auth/me')).user; } catch { location.replace('/login?next=/admin'); return; }
  if (S.me.role !== 'admin') { location.replace('/kitchen'); return; }
  S.cfg = await api('/api/config');
  money = moneyFormatter(S.cfg);
  renderShell();
  addEventListener('hashchange', () => { S.tab = location.hash.slice(1) || 'dashboard'; show(); });

  // Live refresh of the dashboard/orders when anything changes.
  const es = new EventSource('/api/staff/stream');
  let timer;
  es.addEventListener('order', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (S.tab === 'dashboard' || S.tab === 'orders' || S.tab === 'tables') show(true); }, 600);
  });
}

function renderShell() {
  document.title = t('title');
  $('#app').replaceChildren(
    h('header', { class: 'adm-top' },
      h('h1', {}, S.cfg.name),
      h('nav', { class: 'tabs', role: 'tablist' }, TABS.map((id) => h('a', { href: `#${id}`, role: 'tab', id: `tab-${id}` }, t(id)))),
      h('div', { class: 'spacer' }),
      langButton(renderShell),
      h('a', { class: 'btn ghost', href: '/kitchen' }, t('kitchen')),
      h('button', { class: 'btn ghost', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.replace('/login?next=/admin'); } }, t('signOut'))),
    h('main', { id: 'view', class: 'adm-main' }));
  show();
}

function show(quiet = false) {
  for (const id of TABS) $(`#tab-${id}`).setAttribute('aria-selected', String(id === S.tab));
  const fn = { dashboard, menu, tables, orders }[S.tab] || dashboard;
  fn(quiet).catch((e) => { if (e.status === 401) location.replace('/login?next=/admin'); else toast(e.message, 'err'); });
}

// ---------------------------------------------------------------------------
async function dashboard() {
  const s = await api('/api/admin/stats');
  const maxHour = Math.max(1, ...s.byHour);
  const maxQty = Math.max(1, ...s.topItems.map((i) => i.qty));
  const firstHour = s.byHour.findIndex((x) => x > 0);
  const hours = s.byHour.map((n, hr) => ({ n, hr })).filter(({ hr }) => hr >= Math.min(firstHour < 0 ? 10 : firstHour, 10) && hr <= 23);
  $('#view').replaceChildren(
    h('div', { class: 'kpis' },
      kpi(t('revenue'), money(s.revenue)),
      kpi(t('orderCount'), String(s.orders)),
      kpi(t('avgTicket'), money(s.avgTicket)),
      kpi(t('avgPrep'), s.avgPrepMs == null ? '—' : t('min', { n: Math.round(s.avgPrepMs / 60000) })),
      kpi(t('inKitchen'), String(s.active)),
      kpi(t('openTables'), String(s.openTables))),
    h('div', { class: 'two' },
      h('section', { class: 'card' }, h('h2', {}, t('topItems')),
        s.topItems.length ? h('ul', { class: 'bars' }, s.topItems.map((i) => h('li', {},
          h('span', { class: 'bl' }, pick(i.name)),
          h('span', { class: 'bar' }, h('span', { style: { width: `${(i.qty / maxQty) * 100}%` } })),
          h('span', { class: 'bv' }, `${i.qty}`)))) : h('p', { class: 'muted' }, t('noOrders'))),
      h('section', { class: 'card' }, h('h2', {}, t('byHour')),
        h('div', { class: 'hours', role: 'img', 'aria-label': t('byHourAria') }, hours.map(({ n, hr }) => h('div', { class: 'hcol', title: t('hourTitle', { h: hr, n }) },
          h('span', { class: 'hbar', style: { height: `${(n / maxHour) * 100}%` } }), h('span', { class: 'hl' }, String(hr))))))),
  );
}
const kpi = (label, value) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', {}, value));

// ---------------------------------------------------------------------------
async function menu() {
  const m = await api('/api/menu');
  const second = (o) => (getLang() === 'zh' ? o.en : o.zh);
  $('#view').replaceChildren(
    h('p', { class: 'muted' }, t('menuHint')),
    ...m.categories.map((c) => h('section', { class: 'card' },
      h('h2', {}, pick(c.name), h('span', { class: 'muted' }, ` · ${second(c.name)}`)),
      h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, h('th', {}, t('item')), h('th', {}, t('price')), h('th', {}, t('available')))),
        h('tbody', {}, m.items.filter((i) => i.categoryId === c.id).map((i) => menuRow(i, second)))))));
}

function menuRow(i, second) {
  const name = pick(i.name);
  const price = h('input', {
    type: 'number', min: '0', step: '0.10', value: (i.price / 100).toFixed(2), class: 'price-in', 'aria-label': t('priceOf', { name }),
    onchange: async (e) => {
      const cents = Math.round(Number(e.target.value) * 100);
      if (!Number.isFinite(cents) || cents < 0) { toast(t('invalidPrice'), 'err'); return; }
      try { await api(`/api/admin/items/${i.id}`, { method: 'PATCH', body: { price: cents } }); toast(`${name}: ${money(cents)}`, 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    },
  });
  const sw = h('input', {
    type: 'checkbox', role: 'switch', class: 'switch', checked: i.available, 'aria-label': t('availableOf', { name }),
    onchange: async (e) => {
      try { await api(`/api/admin/items/${i.id}`, { method: 'PATCH', body: { available: e.target.checked } }); toast(t(e.target.checked ? 'backOn' : 'soldOut', { name }), e.target.checked ? 'ok' : 'warn'); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'err'); }
    },
  });
  return h('tr', {},
    h('td', {}, name, h('small', { class: 'muted' }, ` ${second(i.name)}`)),
    h('td', {}, h('span', { class: 'cur' }, S.cfg.currency), price),
    h('td', {}, sw));
}

// ---------------------------------------------------------------------------
async function tables() {
  const { tables } = await api('/api/admin/tables');
  const name = h('input', { placeholder: t('newTablePh'), maxlength: '40', 'aria-label': t('newTableAria') });
  $('#view').replaceChildren(
    h('div', { class: 'row-between' },
      h('p', { class: 'muted' }, t('tablesHint')),
      h('form', { class: 'inline', onsubmit: async (e) => { e.preventDefault(); try { await api('/api/admin/tables', { method: 'POST', body: { name: name.value.trim() || undefined } }); tables(); } catch (err) { toast(err.message, 'err'); } } },
        name, h('button', { class: 'btn primary' }, t('addTable'))),
      h('button', { class: 'btn', onclick: () => print() }, t('printAll'))),
    h('div', { class: 'qr-grid' }, tables.map((tb) => {
      const tn = tableName(tb.name);
      return h('article', { class: `qr-card ${tb.open ? 'open' : ''}` },
        h('img', { src: `/api/admin/tables/${tb.id}/qr.svg?v=${tb.v}`, alt: t('qrAlt', { name: tn }), width: '180', height: '180', loading: 'lazy' }),
        h('h3', {}, tn),
        h('p', { class: 'muted small' }, tb.open ? t('occupied', { n: tb.orders }) : t('free'), ` · QR v${tb.v}`),
        h('div', { class: 'qr-actions no-print' },
          h('a', { class: 'btn small', href: tb.url, target: '_blank', rel: 'noopener' }, t('open')),
          h('button', { class: 'btn small', disabled: !tb.open, onclick: () => act(tb, 'close', t('closeConfirm', { name: tn })) }, t('closeBill')),
          h('button', { class: 'btn small danger', onclick: () => act(tb, 'rotate', t('rotateConfirm', { name: tn })) }, t('rotate'))));
    })));
}

async function act(tb, action, question) {
  if (!confirm(question)) return;
  try { await api(`/api/admin/tables/${tb.id}/${action}`, { method: 'POST' }); toast(t('done'), 'ok'); tables(); }
  catch (err) { toast(err.message, 'err'); }
}

// ---------------------------------------------------------------------------
async function orders() {
  const { orders } = await api('/api/staff/orders?scope=today');
  const fmt = new Intl.DateTimeFormat(getLang() === 'zh' ? 'zh-CN' : S.cfg.locale, { hour: 'numeric', minute: '2-digit', timeZone: S.cfg.timezone });
  $('#view').replaceChildren(h('section', { class: 'card' },
    h('h2', {}, t('todaysOrders', { n: orders.length })),
    orders.length ? h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['colNo', 'colTime', 'colTable', 'colItems', 'colTotal', 'colStatus', 'colPaid'].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, [...orders].reverse().map((o) => h('tr', {},
        h('td', {}, pad(o.no)), h('td', {}, fmt.format(o.createdAt)), h('td', {}, tableName(o.tableName)),
        h('td', { class: 'items-cell' }, o.items.map((l) => `${l.qty}× ${pick(l.name)}`).join(', ')),
        h('td', {}, money(o.total)),
        h('td', {}, h('span', { class: `pill ${o.status}` }, t(`s_${o.status}`))),
        h('td', {}, o.paid ? '✅' : '—'))))) : h('p', { class: 'muted' }, t('noOrders'))));
}

boot();
