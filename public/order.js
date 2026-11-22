import { $, h, api, apiRetry, moneyFormatter, toast, ls, uuid, getLang, setLang, fill } from './common.js';

const token = location.pathname.split('/')[2] || '';
const T = encodeURIComponent(decodeURIComponent(token));

const I18N = {
  en: {
    table: 'Table', menu: 'Menu', myOrders: 'My orders', search: 'Search dishes or drinks',
    popular: 'Popular', spicy: 'Spicy', veg: 'Vegetarian', soldOut: 'Sold out', add: 'Add',
    required: 'Required', optional: 'Optional', pickUpTo: 'Pick up to {n}', pickN: 'Pick {n}',
    note: 'Special request', notePh: 'e.g. no onions, less salt', addToCart: 'Add to order',
    viewCart: 'View order', items: '{n} item(s)', yourOrder: 'Your order', subtotal: 'Subtotal',
    service: 'Service charge', total: 'Total', payAtCounter: 'Pay at counter', payOnline: 'Pay online',
    comingSoon: 'Coming soon', placeOrder: 'Place order', placing: 'Sending…', sentToKitchen: 'Order #{no} sent to the kitchen!',
    noOrders: 'No orders yet', noOrdersSub: 'Browse the menu and place your first order.',
    received: 'Received', preparing: 'Preparing', ready: 'Ready', served: 'Served', cancelled: 'Cancelled',
    readyToast: 'Order #{no} is ready!', tableTotal: 'Table total', callWaiter: 'Call waiter', requestBill: 'Request bill',
    water: 'Water', requested: 'A staff member is on the way.', alreadyRequested: 'Already requested — staff will be with you shortly.',
    soldOutNow: '{name} just sold out and was removed.', invalid: 'This QR code is no longer valid',
    invalidSub: 'Please ask a staff member for help, or scan the code on your table again.', thanks: 'Thank you! Your table has been closed.',
    offline: 'You are offline. Your order is saved and will be sent when you reconnect.', retry: 'Retry',
    noResults: 'No dishes match your search.', empty: 'Your order is empty', remove: 'Remove', close: 'Close',
    sentNote: 'Orders go straight to the kitchen. You can keep adding more.', each: 'each',
    connProblem: 'Connection problem', connSub: 'We could not load the menu.', tooMany: 'Too many orders, please wait a moment.',
    placeFailed: 'Could not place order ({msg})', error: 'Error: {msg}', switchLang: '切换到中文', decrease: 'Decrease quantity',
    increase: 'Increase quantity', progress: 'Order progress', categories: 'Categories', tableName: 'Table {n}',
    welcome: 'Welcome', itemsN: '{n} items', itemN: '1 item', orderNo: 'Order', options: 'Choose',
  },
  zh: {
    table: '桌号', menu: '菜单', myOrders: '我的订单', search: '搜索菜品或饮料',
    popular: '人气', spicy: '辣', veg: '素食', soldOut: '已售完', add: '添加',
    required: '必选', optional: '可选', pickUpTo: '最多选 {n} 项', pickN: '选 {n} 项',
    note: '特别要求', notePh: '例如：不要洋葱、少盐', addToCart: '加入订单',
    viewCart: '查看订单', items: '{n} 件', yourOrder: '您的订单', subtotal: '小计',
    service: '服务费', total: '总计', payAtCounter: '柜台付款', payOnline: '在线支付',
    comingSoon: '即将推出', placeOrder: '下单', placing: '发送中…', sentToKitchen: '订单 #{no} 已送往厨房！',
    noOrders: '暂无订单', noOrdersSub: '浏览菜单并下第一单吧。',
    received: '已接单', preparing: '制作中', ready: '已完成', served: '已上桌', cancelled: '已取消',
    readyToast: '订单 #{no} 已完成！', tableTotal: '本桌合计', callWaiter: '呼叫服务员', requestBill: '请求结账',
    water: '要水', requested: '服务员马上就来。', alreadyRequested: '已呼叫，请稍候。',
    soldOutNow: '{name} 刚刚售完，已从订单移除。', invalid: '此二维码已失效',
    invalidSub: '请联系服务员，或重新扫描桌上的二维码。', thanks: '谢谢光临！本桌已结账。',
    offline: '您已离线。订单已保存，联网后会自动发送。', retry: '重试',
    noResults: '没有找到相关菜品。', empty: '订单是空的', remove: '移除', close: '关闭',
    sentNote: '订单会直接送到厨房，您可以随时加点。', each: '每份',
    connProblem: '网络连接出错', connSub: '暂时无法加载菜单。', tooMany: '下单太频繁，请稍候再试。',
    placeFailed: '下单失败（{msg}）', error: '出错了：{msg}', switchLang: 'Switch to English', decrease: '减少数量',
    increase: '增加数量', progress: '订单进度', categories: '菜品分类', tableName: '{n}号桌',
    welcome: '欢迎光临', itemsN: '{n} 件', itemN: '1 件', orderNo: '订单', options: '选择',
  },
};

const S = {
  lang: getLang(),
  cfg: null, menu: null, table: null, orders: [],
  cart: ls.get(`cart:${token}`, []),
  view: 'menu', query: '', pendingKey: ls.get(`pending:${token}`, null), placing: false,
};
let money = (c) => String(c);

const t = (k, vars = {}) => (I18N[S.lang][k] || I18N.en[k] || k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const tx = (o) => (o ? o[S.lang] || o.en : '');
// "Table 5" → "5号桌" in Chinese; custom table names are shown as-is.
const tableLabel = () => { const m = /^Table\s+(\S+)$/i.exec(S.table.name); return m ? t('tableName', { n: m[1] }) : S.table.name; };
const saveCart = () => ls.set(`cart:${token}`, S.cart);
const itemById = (id) => S.menu.items.find((i) => i.id === id);

// ---------------------------------------------------------------------------
// Pricing (display only — the server re-prices every order)
// ---------------------------------------------------------------------------
function unitPrice(item, optionIds) {
  let p = item.price;
  for (const g of item.optionGroups) for (const o of g.options) if (optionIds.includes(`${g.id}:${o.id}`)) p += o.price;
  return p;
}
function totals(lines) {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const service = Math.round(subtotal * S.cfg.serviceChargeRate);
  const tax = Math.round((subtotal + service) * S.cfg.taxRate);
  return { subtotal, service, tax, total: subtotal + service + tax };
}
function cartLines() {
  return S.cart.map((c) => {
    const item = itemById(c.itemId);
    if (!item) return null;
    const u = unitPrice(item, c.optionIds);
    return { ...c, item, unit: u, lineTotal: u * c.qty };
  }).filter(Boolean);
}
const cartCount = () => S.cart.reduce((s, c) => s + c.qty, 0);
const optionLabel = (item, optionIds) => item.optionGroups.flatMap((g) => g.options.filter((o) => optionIds.includes(`${g.id}:${o.id}`)).map((o) => tx(o.name))).join(' · ');

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  try {
    const [cfg, menu, tbl] = await Promise.all([apiRetry('/api/config'), apiRetry('/api/menu'), api(`/api/t/${T}`)]);
    S.cfg = cfg; S.menu = menu; S.table = tbl.table; S.orders = tbl.orders;
    money = moneyFormatter(cfg);
    pruneCart();
    renderShell();
    connectStream();
    if (S.pendingKey && S.cart.length) placeOrder(); // resume an order interrupted by a dropped connection
  } catch (err) {
    if (err.status === 404) return fatal();
    fill($('#app'), h('div', { class: 'fatal' },
      h('p', { class: 'eyebrow' }, h('span', { class: 'dot' }), S.cfg?.name || ''), h('h1', {}, t('connProblem')),
      h('p', {}, t('connSub')),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, t('retry'))));
  }
}

function fatal() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  fill($('#app'), h('div', { class: 'fatal' },
    h('p', { class: 'eyebrow' }, h('span', { class: 'dot' }), 'QR'), h('h1', {}, t('invalid')), h('p', {}, t('invalidSub'))));
  $('#app').removeAttribute('aria-busy');
}

function pruneCart() {
  const before = S.cart.length;
  S.cart = S.cart.filter((c) => itemById(c.itemId)?.available);
  if (S.cart.length !== before) saveCart();
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function renderShell() {
  document.documentElement.lang = S.lang === 'zh' ? 'zh-Hans' : 'en';
  document.title = `${S.cfg.name} · ${tableLabel()}`;
  const app = $('#app');
  app.removeAttribute('aria-busy');
  fill(app, 
    h('header', { class: 'top' },
      h('div', { class: 'masthead' },
        h('p', { class: 'eyebrow' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), `${tableLabel()} · ${t('welcome')}`),
        h('h1', {}, S.cfg.name)),
      h('button', { class: 'lang', 'aria-label': t('switchLang'), onclick: () => { S.lang = S.lang === 'en' ? 'zh' : 'en'; setLang(S.lang); renderShell(); } }, S.lang === 'en' ? '中文' : 'EN')),
    h('nav', { class: 'seg', role: 'tablist' },
      h('button', { role: 'tab', id: 'tabMenu', 'aria-selected': String(S.view === 'menu'), onclick: () => setView('menu') }, t('menu')),
      h('button', { role: 'tab', id: 'tabOrders', 'aria-selected': String(S.view === 'orders'), onclick: () => setView('orders') }, t('myOrders'), h('span', { class: 'badge', id: 'ordersBadge' }))),
    h('main', { id: 'menuView', hidden: S.view !== 'menu' },
      h('div', { class: 'search' },
        h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: S.query, oninput: (e) => { S.query = e.target.value; renderMenu(); } })),
      h('nav', { class: 'chips', id: 'chips', 'aria-label': t('categories') }),
      h('div', { id: 'list' })),
    h('main', { id: 'ordersView', hidden: S.view !== 'orders' }),
    h('div', { class: 'cartbar-wrap', id: 'cartbar' }),
  );
  renderMenu();
  renderOrders();
  renderCartBar();
}

function setView(v) {
  S.view = v;
  $('#menuView').hidden = v !== 'menu';
  $('#ordersView').hidden = v !== 'orders';
  $('#tabMenu').setAttribute('aria-selected', String(v === 'menu'));
  $('#tabOrders').setAttribute('aria-selected', String(v === 'orders'));
  renderCartBar();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Menu list
// ---------------------------------------------------------------------------
let spy;
function renderMenu() {
  const q = S.query.trim().toLowerCase();
  const match = (i) => !q || [i.name.en, i.name.zh, i.desc.en, i.desc.zh].some((s) => s.toLowerCase().includes(q));
  const qtyInCart = (id) => S.cart.filter((c) => c.itemId === id).reduce((s, c) => s + c.qty, 0);

  const sections = [];
  const popular = S.menu.items.filter((i) => i.tags.includes('popular') && match(i));
  const cats = [...(q ? [] : [{ id: 'popular', name: { en: I18N.en.popular, zh: I18N.zh.popular }, items: popular }]),
    ...S.menu.categories.map((c) => ({ ...c, items: S.menu.items.filter((i) => i.categoryId === c.id && match(i)) }))]
    .filter((c) => c.items.length);

  cats.forEach((c, idx) => {
    sections.push(h('section', { class: 'cat', id: `cat-${c.id}`, 'aria-labelledby': `h-${c.id}` },
      h('h2', { id: `h-${c.id}` }, h('span', { class: 'num', 'aria-hidden': 'true' }, String(idx + 1).padStart(2, '0')), tx(c.name)),
      c.items.map((i) => itemRow(i, qtyInCart(i.id), c.id === 'popular'))));
  });
  if (!sections.length) sections.push(h('p', { class: 'empty' }, t('noResults')));
  fill($('#list'), ...sections);

  fill($('#chips'), ...cats.map((c, idx) => h('a', {
    href: `#cat-${c.id}`, class: idx === 0 ? 'chip active' : 'chip', dataset: { cat: c.id },
    onclick: (e) => { e.preventDefault(); const top = document.getElementById(`cat-${c.id}`).getBoundingClientRect().top + scrollY - 118; window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); },
  }, tx(c.name))));

  spy?.disconnect();
  spy = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      const id = e.target.id.slice(4);
      document.querySelectorAll('.chip').forEach((ch) => ch.classList.toggle('active', ch.dataset.cat === id));
      document.querySelector(`.chip[data-cat="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }, { rootMargin: '-120px 0px -65% 0px' });
  document.querySelectorAll('section.cat').forEach((s) => spy.observe(s));
}

function itemRow(i, qty, inPopular) {
  const tags = i.tags.filter((tg) => tg !== 'popular' || !inPopular);
  return h('button', {
    class: `item${i.available ? '' : ' soldout'}`, disabled: !i.available,
    'aria-label': `${tx(i.name)}, ${money(i.price)}${i.available ? '' : ', ' + t('soldOut')}`,
    onclick: () => openItem(i),
  },
  h('div', { class: 'info' },
    h('div', { class: 'row1' }, h('span', { class: 'name' }, tx(i.name)), h('span', { class: 'price' }, money(i.price))),
    h('p', { class: 'desc' }, tx(i.desc)),
    (tags.length || !i.available) ? h('div', { class: 'tags' },
      !i.available ? h('span', { class: 'tag so' }, t('soldOut')) : null,
      tags.map((tg) => h('span', { class: `tag ${tg}` }, t(tg)))) : null),
  // Photos appear automatically once a menu item has an `image` URL.
  h('div', { class: 'media' },
    i.image ? h('img', { class: 'photo', src: i.image, alt: '', loading: 'lazy', decoding: 'async' }) : null,
    i.available ? h('span', { class: qty ? 'add has' : 'add', 'aria-hidden': 'true' }, qty ? String(qty) : '+') : h('span', { class: 'add ghost', 'aria-hidden': 'true' })));
}

// ---------------------------------------------------------------------------
// Item sheet (options, note, quantity)
// ---------------------------------------------------------------------------
function openItem(item) {
  const dlg = $('#itemSheet');
  const sel = new Map(item.optionGroups.map((g) => [g.id, new Set(g.min >= 1 && g.max === 1 ? [g.options[0].id] : [])]));
  let qty = 1;
  const note = h('textarea', { id: 'note', maxlength: '140', rows: '2', placeholder: t('notePh') });
  const addBtn = h('button', { class: 'btn primary grow', type: 'button' });

  const optionIds = () => [...sel].flatMap(([g, set]) => [...set].map((o) => `${g}:${o}`));
  const valid = () => item.optionGroups.every((g) => sel.get(g.id).size >= g.min && sel.get(g.id).size <= g.max);
  const update = () => {
    addBtn.textContent = `${t('add')} · ${money(unitPrice(item, optionIds()) * qty)}`;
    addBtn.disabled = !valid();
    qtyEl.textContent = String(qty);
    minus.disabled = qty <= 1;
    for (const g of item.optionGroups) {
      if (g.max <= 1) continue;
      const full = sel.get(g.id).size >= g.max;
      dlg.querySelectorAll(`input[name="g-${g.id}"]`).forEach((inp) => { inp.disabled = full && !inp.checked; });
    }
  };

  const groups = item.optionGroups.map((g) => {
    const single = g.max === 1;
    const hint = g.min >= 1 ? (single ? t('required') : `${t('required')} · ${t('pickUpTo', { n: g.max })}`) : `${t('optional')} · ${t('pickUpTo', { n: g.max })}`;
    return h('fieldset', { class: 'group' },
      h('legend', {}, h('span', {}, tx(g.name)), h('small', { class: g.min ? 'req' : '' }, hint)),
      g.options.map((o) => h('label', { class: 'opt' },
        h('input', {
          type: single ? 'radio' : 'checkbox', name: `g-${g.id}`, value: o.id, checked: sel.get(g.id).has(o.id),
          onchange: (e) => {
            const set = sel.get(g.id);
            if (single) { set.clear(); set.add(o.id); } else e.target.checked ? set.add(o.id) : set.delete(o.id);
            update();
          },
        }),
        h('span', { class: 'opt-name' }, tx(o.name)),
        o.price ? h('span', { class: 'opt-price' }, `+${money(o.price)}`) : null)));
  });

  const qtyEl = h('span', { class: 'qty', 'aria-live': 'polite' });
  const minus = h('button', { class: 'step', type: 'button', 'aria-label': t('decrease'), onclick: () => { qty = Math.max(1, qty - 1); update(); } }, '−');
  const plus = h('button', { class: 'step', type: 'button', 'aria-label': t('increase'), onclick: () => { qty = Math.min(50, qty + 1); update(); } }, '+');

  addBtn.addEventListener('click', () => {
    if (!valid()) return;
    const ids = optionIds().sort();
    const n = note.value.trim().slice(0, 140);
    const existing = S.cart.find((c) => c.itemId === item.id && c.note === n && c.optionIds.join() === ids.join());
    if (existing) existing.qty = Math.min(50, existing.qty + qty);
    else S.cart.push({ key: uuid(), itemId: item.id, qty, optionIds: ids, note: n });
    saveCart();
    dlg.close();
    renderMenu();
    renderCartBar(true);
  });

  fill(dlg, 
    item.image
      ? h('div', { class: 'sheet-hero' }, h('img', { src: item.image, alt: '' }),
        h('button', { class: 'x', type: 'button', 'aria-label': t('close'), onclick: () => dlg.close() }, '✕'))
      : h('div', { class: 'sheet-top' },
        h('p', { class: 'eyebrow' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), tx(S.menu.categories.find((c) => c.id === item.categoryId)?.name)),
        h('button', { class: 'x plain', type: 'button', 'aria-label': t('close'), onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'sheet-body' },
      h('h2', { id: 'itemSheetTitle' }, tx(item.name)),
      h('p', { class: 'muted' }, tx(item.desc)),
      h('p', { class: 'price big' }, money(item.price)),
      groups,
      h('label', { class: 'note-label', for: 'note' }, t('note')), note),
    h('div', { class: 'sheet-foot' }, h('div', { class: 'stepper' }, minus, qtyEl, plus), addBtn),
  );
  update();
  openSheet(dlg);
}

function openSheet(dlg) {
  dlg.showModal();
  dlg.scrollTop = 0;
  dlg.querySelector('.sheet-body')?.scrollTo(0, 0);
}

for (const id of ['itemSheet', 'cartSheet']) {
  // tap on the backdrop closes the sheet
  document.getElementById(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}

// ---------------------------------------------------------------------------
// Cart bar + cart sheet
// ---------------------------------------------------------------------------
function renderCartBar(bump = false) {
  const wrap = $('#cartbar');
  if (!wrap) return;
  const n = cartCount();
  if (!n || S.view !== 'menu') { fill(wrap); document.body.classList.remove('has-cart'); return; }
  document.body.classList.add('has-cart');
  const { subtotal } = totals(cartLines());
  const bar = h('button', { class: `cartbar${bump ? ' bump' : ''}`, onclick: openCart },
    h('span', { class: 'count' }, n === 1 ? t('itemN') : t('itemsN', { n })),
    h('span', { class: 'label' }, t('viewCart')),
    h('span', { class: 'sum' }, money(subtotal)));
  fill(wrap, bar);
}

function openCart() {
  renderCart();
  openSheet($('#cartSheet'));
}

function renderCart() {
  const dlg = $('#cartSheet');
  const lines = cartLines();
  const tt = totals(lines);
  if (!lines.length) {
    fill(dlg, h('div', { class: 'sheet-body center' }, h('p', { class: 'empty' }, t('empty')),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('close'))));
    return;
  }
  const changeQty = (key, d) => {
    const c = S.cart.find((x) => x.key === key);
    if (!c) return;
    c.qty += d;
    if (c.qty <= 0) S.cart = S.cart.filter((x) => x.key !== key);
    else c.qty = Math.min(50, c.qty);
    saveCart(); renderCart(); renderCartBar(); renderMenu();
    if (!S.cart.length) dlg.close();
  };

  fill(dlg, 
    h('div', { class: 'sheet-head' },
      h('h2', { id: 'cartSheetTitle' }, t('yourOrder'), h('span', { class: 'muted' }, ` · ${tableLabel()}`)),
      h('button', { class: 'x plain', type: 'button', 'aria-label': t('close'), onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'sheet-body' },
      h('ul', { class: 'lines' }, lines.map((l) => h('li', { class: 'line' },
        h('div', { class: 'line-info' },
          h('div', { class: 'name' }, tx(l.item.name)),
          l.optionIds.length ? h('div', { class: 'muted small' }, optionLabel(l.item, l.optionIds)) : null,
          l.note ? h('div', { class: 'note' }, `“${l.note}”`) : null,
          h('div', { class: 'price' }, money(l.lineTotal))),
        h('div', { class: 'stepper small' },
          h('button', { class: 'step', 'aria-label': `${t('remove')} 1 ${tx(l.item.name)}`, onclick: () => changeQty(l.key, -1) }, l.qty === 1 ? '×' : '−'),
          h('span', { class: 'qty' }, String(l.qty)),
          h('button', { class: 'step', 'aria-label': `${t('add')} 1 ${tx(l.item.name)}`, onclick: () => changeQty(l.key, 1) }, '+'))))),
      h('dl', { class: 'summary' },
        h('dt', {}, t('subtotal')), h('dd', {}, money(tt.subtotal)),
        S.cfg.serviceChargeRate ? [h('dt', {}, `${t('service')} (${Math.round(S.cfg.serviceChargeRate * 100)}%)`), h('dd', {}, money(tt.service))] : null,
        S.cfg.taxRate ? [h('dt', {}, `${S.cfg.taxLabel} (${Math.round(S.cfg.taxRate * 100)}%)`), h('dd', {}, money(tt.tax))] : null,
        h('dt', { class: 'total' }, t('total')), h('dd', { class: 'total' }, money(tt.total))),
      h('fieldset', { class: 'pay' },
        h('label', { class: 'pay-opt' }, h('input', { type: 'radio', name: 'pay', value: 'counter', checked: true }), h('span', {}, t('payAtCounter'))),
        h('label', { class: 'pay-opt disabled' }, h('input', { type: 'radio', name: 'pay', value: 'online', disabled: true }), h('span', {}, t('payOnline')), h('small', { class: 'soon' }, t('comingSoon')))),
      h('p', { class: 'muted small center' }, t('sentNote'))),
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn primary grow', id: 'placeBtn', disabled: S.placing, onclick: placeOrder },
        S.placing ? t('placing') : `${t('placeOrder')} · ${money(tt.total)}`)),
  );
}

async function placeOrder() {
  if (S.placing || !S.cart.length) return;
  S.placing = true;
  // The idempotency key survives reloads, so a retry after a dropped
  // connection can never create a duplicate order.
  if (!S.pendingKey) { S.pendingKey = uuid(); ls.set(`pending:${token}`, S.pendingKey); }
  if ($('#cartSheet').open) renderCart();
  try {
    const body = { payment: 'counter', items: S.cart.map((c) => ({ itemId: c.itemId, qty: c.qty, optionIds: c.optionIds, note: c.note })) };
    const { order } = await apiRetry(`/api/t/${T}/orders`, { method: 'POST', body, headers: { 'Idempotency-Key': S.pendingKey } });
    S.cart = []; saveCart();
    S.pendingKey = null; ls.del(`pending:${token}`);
    upsertOrder(order);
    $('#cartSheet').close();
    toast(t('sentToKitchen', { no: pad(order.no) }), 'ok');
    navigator.vibrate?.(30);
    renderMenu();
    setView('orders');
  } catch (err) {
    if (err.status === 409 && err.data?.error === 'sold_out') {
      const item = itemById(err.data.itemId);
      if (item) item.available = false;
      S.cart = S.cart.filter((c) => c.itemId !== err.data.itemId); saveCart();
      S.pendingKey = null; ls.del(`pending:${token}`);
      toast(t('soldOutNow', { name: item ? tx(item.name) : '' }), 'warn');
      renderMenu();
    } else if (err.status === 404) {
      return fatal();
    } else if (!err.status) {
      toast(t('offline'), 'warn');
      addEventListener('online', () => placeOrder(), { once: true });
    } else {
      S.pendingKey = null; ls.del(`pending:${token}`);
      toast(err.status === 429 ? t('tooMany') : t('placeFailed', { msg: err.message }), 'err');
    }
  } finally {
    S.placing = false;
    renderCartBar();
    if ($('#cartSheet').open) renderCart();
  }
}

// ---------------------------------------------------------------------------
// My orders
// ---------------------------------------------------------------------------
const STEPS = ['new', 'preparing', 'ready', 'served'];
const STEP_LABEL = { new: 'received', preparing: 'preparing', ready: 'ready', served: 'served' };
const pad = (n) => String(n).padStart(3, '0');

function upsertOrder(o) {
  const i = S.orders.findIndex((x) => x.id === o.id);
  if (i >= 0) S.orders[i] = o; else S.orders.push(o);
  renderOrders();
}

function renderOrders() {
  const view = $('#ordersView');
  if (!view) return;
  const active = S.orders.filter((o) => o.status !== 'served' && o.status !== 'cancelled').length;
  const badge = $('#ordersBadge');
  badge.textContent = active ? String(active) : '';
  badge.hidden = !active;

  const fmtTime = new Intl.DateTimeFormat(S.lang === 'zh' ? 'zh-CN' : S.cfg.locale, { hour: 'numeric', minute: '2-digit', timeZone: S.cfg.timezone });
  const tableTotal = S.orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);

  const cards = [...S.orders].reverse().map((o) => {
    const idx = STEPS.indexOf(o.status);
    return h('article', { class: `order ${o.status}` },
      h('header', {},
        h('div', {}, h('strong', {}, `#${pad(o.no)}`), h('span', { class: 'muted' }, ` · ${fmtTime.format(o.createdAt)}`)),
        h('span', { class: `status ${o.status}` }, t(o.status === 'new' ? 'received' : o.status))),
      o.status === 'cancelled' ? null : h('ol', { class: 'progress', 'aria-label': t('progress') },
        STEPS.map((s, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '', 'aria-current': i === idx ? 'step' : null }, t(STEP_LABEL[s])))),
      h('ul', { class: 'order-items' }, o.items.map((l) => h('li', {},
        h('span', { class: 'q' }, `${l.qty}×`),
        h('span', { class: 'n' }, tx(l.name),
          l.options.length ? h('small', {}, l.options.map((x) => tx(x.name)).join(' · ')) : null,
          l.note ? h('small', { class: 'note' }, `“${l.note}”`) : null),
        h('span', { class: 'p' }, money(l.lineTotal))))),
      h('footer', {}, h('span', {}, t('total')), h('strong', {}, money(o.total))));
  });

  fill(view, 
    S.orders.length ? h('div', { class: 'orders' }, cards) : h('div', { class: 'empty-state' },
      h('span', { class: 'ornament', 'aria-hidden': 'true' }), h('h2', {}, t('noOrders')), h('p', { class: 'muted' }, t('noOrdersSub')),
      h('button', { class: 'btn primary', onclick: () => setView('menu') }, t('menu'))),
    S.orders.length ? h('div', { class: 'table-total' }, h('span', {}, t('tableTotal')), h('strong', {}, money(tableTotal))) : null,
    h('div', { class: 'service' },
      serviceBtn('waiter', t('callWaiter')),
      serviceBtn('water', t('water')),
      serviceBtn('bill', t('requestBill'))),
  );
}

function serviceBtn(type, label) {
  return h('button', {
    class: 'svc', onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { await api(`/api/t/${T}/requests`, { method: 'POST', body: { type } }); toast(t('requested'), 'ok'); }
      catch (err) { toast(err.status === 429 ? t('alreadyRequested') : t('error', { msg: err.message }), err.status === 429 ? '' : 'err'); }
      finally { setTimeout(() => { btn.disabled = false; }, 5000); }
    },
  }, label);
}

// ---------------------------------------------------------------------------
// Live updates (SSE). On every (re)connect we resync, so no event is lost.
// ---------------------------------------------------------------------------
function connectStream() {
  const es = new EventSource(`/api/t/${T}/stream`);
  let first = true;
  es.addEventListener('open', async () => {
    if (first) { first = false; return; }
    try {
      const [menu, tbl] = await Promise.all([api('/api/menu'), api(`/api/t/${T}`)]);
      S.menu = menu; S.orders = tbl.orders; pruneCart(); renderMenu(); renderOrders(); renderCartBar();
    } catch (err) { if (err.status === 404) { es.close(); fatal(); } }
  });
  es.addEventListener('order', (e) => {
    const o = JSON.parse(e.data);
    const prev = S.orders.find((x) => x.id === o.id);
    if (o.status === 'ready' && prev?.status !== 'ready') { toast(t('readyToast', { no: pad(o.no) }), 'ok'); navigator.vibrate?.([80, 60, 80]); }
    upsertOrder(o);
  });
  es.addEventListener('menu', async () => {
    try { S.menu = await api('/api/menu'); pruneCart(); renderMenu(); renderCartBar(); } catch {}
  });
  es.addEventListener('session_closed', () => { S.orders = []; renderOrders(); toast(t('thanks'), 'ok'); });
  es.addEventListener('invalidated', () => { es.close(); fatal(); });
}

boot();
