// Data access layer. The prototype keeps everything in memory and persists
// to a JSON file (atomic write-then-rename). Every read/write the server makes
// goes through this class, so swapping in PostgreSQL (db/schema.sql) later
// only means re-implementing these methods.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { seedData } from './seed.js';
import { config } from './config.js';
import { hashPassword, verifyPassword, useSessionStore, destroyUserSessions } from './security.js';

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('base64url')}`;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.restaurant.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.restaurant.timezone, hour: '2-digit', hour12: false });
export const dayKey = (ts = Date.now()) => dayFmt.format(ts);

class Store {
  constructor(file) {
    this.file = path.resolve(file);
    this.state = null;
    this.ready = false;
    this.idem = new Map(); // idempotency key -> { orderId, exp }
    this.writing = false;
    this.dirty = false;
    this.timer = null;
    this.menuCache = null;
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      this.state = seedData();
    }
    // Staff sign-ins survive restarts; expired ones are dropped on load.
    const now = Date.now();
    const sessions = new Map(Object.entries(this.state.sessions || {}).filter(([, v]) => v.exp > now));
    useSessionStore(sessions, () => { this.state.sessions = Object.fromEntries(sessions); this.save(); });
    this.state.sessions = Object.fromEntries(sessions);

    // The .env passwords are the source of truth for the two built-in staff
    // accounts: change ADMIN_PASSWORD / KITCHEN_PASSWORD and restart to rotate.
    for (const [username, role, password] of [['admin', 'admin', config.adminPassword], ['kitchen', 'kitchen', config.kitchenPassword]]) {
      const user = this.state.users.find((u) => u.username === username);
      if (!user) this.state.users.push({ id: newId('usr'), username, role, hash: hashPassword(password) });
      else if (!verifyPassword(password, user.hash)) {
        user.hash = hashPassword(password);
        destroyUserSessions(user.id); // new password → sign out every device on that account
      }
    }
    this.reindex();
    this.flushSync();
    setInterval(() => this.sweepIdem(), 10 * 60_000).unref();
    this.ready = true;
  }

  reindex() {
    this.itemsById = new Map(this.state.items.map((i) => [i.id, i]));
    this.tablesById = new Map(this.state.tables.map((t) => [t.id, t]));
    this.ordersById = new Map(this.state.orders.map((o) => [o.id, o]));
    this.ordersBySession = new Map();
    for (const o of this.state.orders) this.indexSession(o);
  }

  indexSession(o) {
    if (!this.ordersBySession.has(o.sessionId)) this.ordersBySession.set(o.sessionId, []);
    this.ordersBySession.get(o.sessionId).push(o);
  }

  // --- persistence ---------------------------------------------------------
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.writeAsync(); }, 200);
  }

  async writeAsync() {
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    try {
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.state));
      await fs.promises.rename(tmp, this.file);
    } catch (err) {
      console.error('persist failed', err);
    } finally {
      this.writing = false;
      if (this.dirty) { this.dirty = false; this.save(); }
    }
  }

  flushSync() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  // --- menu ----------------------------------------------------------------
  item(id) { return this.itemsById.get(id); }

  // Serialised + pre-compressed once per menu version, so serving the menu to
  // thousands of guests costs almost nothing.
  menuEntity() {
    if (this.menuCache?.version === this.state.menuVersion) return this.menuCache;
    const body = Buffer.from(JSON.stringify({
      version: this.state.menuVersion,
      categories: this.state.categories,
      items: this.state.items,
    }));
    this.menuCache = {
      version: this.state.menuVersion,
      type: 'application/json; charset=utf-8',
      etag: `"m${this.state.menuVersion}-${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 10)}"`,
      body,
      gz: zlib.gzipSync(body, { level: 9 }),
      br: zlib.brotliCompressSync(body),
    };
    return this.menuCache;
  }

  updateItem(id, patch) {
    const item = this.itemsById.get(id);
    if (!item) return null;
    Object.assign(item, patch);
    this.state.menuVersion++;
    this.save();
    return item;
  }

  // --- tables --------------------------------------------------------------
  table(id) { return this.tablesById.get(id); }
  tables() { return this.state.tables; }

  addTable(name) {
    let i = this.state.tables.length + 1;
    while (this.tablesById.has(`T${i}`)) i++;
    const t = { id: `T${i}`, name: name || `Table ${i}`, v: 1, active: true, sessionId: null };
    this.state.tables.push(t);
    this.tablesById.set(t.id, t);
    this.save();
    return t;
  }

  rotateTable(t) { t.v++; t.sessionId = null; this.save(); }

  closeTableSession(t) {
    const orders = t.sessionId ? (this.ordersBySession.get(t.sessionId) || []) : [];
    for (const o of orders) if (o.status !== 'cancelled') o.paid = true;
    t.sessionId = null;
    this.save();
    return orders;
  }

  sessionOrders(t) {
    return t.sessionId ? (this.ordersBySession.get(t.sessionId) || []) : [];
  }

  // --- orders --------------------------------------------------------------
  order(id) { return this.ordersById.get(id); }

  findIdempotent(key) {
    const hit = this.idem.get(key);
    return hit && hit.exp > Date.now() ? this.ordersById.get(hit.orderId) : null;
  }

  sweepIdem() {
    const now = Date.now();
    for (const [k, v] of this.idem) if (v.exp < now) this.idem.delete(k);
  }

  createOrder(table, draft, idemKey) {
    const now = Date.now();
    if (!table.sessionId) table.sessionId = newId('ses');
    const today = dayKey(now);
    if (this.state.counter.date !== today) this.state.counter = { date: today, n: 0 };
    const order = {
      id: newId('ord'),
      no: ++this.state.counter.n,
      day: today,
      tableId: table.id,
      tableName: table.name,
      sessionId: table.sessionId,
      ...draft,
      status: 'new',
      paid: false,
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'new', at: now }],
    };
    this.state.orders.push(order);
    this.ordersById.set(order.id, order);
    this.indexSession(order);
    if (idemKey) this.idem.set(idemKey, { orderId: order.id, exp: now + 24 * 3600_000 });
    this.save();
    return order;
  }

  setOrderStatus(order, status, by) {
    const now = Date.now();
    order.status = status;
    order.updatedAt = now;
    order.history.push({ status, at: now, by });
    this.save();
  }

  ordersToday() {
    const today = dayKey();
    const out = [];
    for (let i = this.state.orders.length - 1; i >= 0; i--) {
      const o = this.state.orders[i];
      if (o.day !== today) break;
      out.push(o);
    }
    return out.reverse();
  }

  activeOrders() {
    const cutoff = Date.now() - 24 * 3600_000;
    const out = [];
    for (let i = this.state.orders.length - 1; i >= 0; i--) {
      const o = this.state.orders[i];
      if (o.createdAt < cutoff) break;
      if (o.status === 'new' || o.status === 'preparing' || o.status === 'ready') out.push(o);
    }
    return out.reverse();
  }

  // --- service requests (call waiter / bill) --------------------------------
  addRequest(table, type) {
    const r = { id: newId('req'), tableId: table.id, tableName: table.name, type, createdAt: Date.now(), resolvedAt: null };
    this.state.requests.push(r);
    if (this.state.requests.length > 500) this.state.requests = this.state.requests.slice(-300);
    this.save();
    return r;
  }

  openRequests() { return this.state.requests.filter((r) => !r.resolvedAt); }

  resolveRequest(id) {
    const r = this.state.requests.find((x) => x.id === id);
    if (r && !r.resolvedAt) { r.resolvedAt = Date.now(); this.save(); }
    return r;
  }

  // --- users ---------------------------------------------------------------
  userByName(username) {
    const u = String(username).toLowerCase();
    return this.state.users.find((x) => x.username === u);
  }

  // --- reporting -----------------------------------------------------------
  stats() {
    const orders = this.ordersToday().filter((o) => o.status !== 'cancelled');
    const revenue = orders.reduce((s, o) => s + o.total, 0);
    const prep = orders
      .map((o) => {
        const start = o.history.find((h) => h.status === 'new')?.at;
        const ready = o.history.find((h) => h.status === 'ready')?.at;
        return start && ready ? ready - start : null;
      })
      .filter((x) => x != null);
    const byItem = new Map();
    for (const o of orders) for (const l of o.items) {
      const cur = byItem.get(l.itemId) || { itemId: l.itemId, name: l.name, emoji: l.emoji, qty: 0, revenue: 0 };
      cur.qty += l.qty;
      cur.revenue += l.lineTotal;
      byItem.set(l.itemId, cur);
    }
    const byHour = Array(24).fill(0);
    for (const o of orders) byHour[Number(hourFmt.format(o.createdAt)) % 24]++;
    return {
      day: dayKey(),
      orders: orders.length,
      revenue,
      avgTicket: orders.length ? Math.round(revenue / orders.length) : 0,
      avgPrepMs: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null,
      active: this.activeOrders().length,
      openTables: this.state.tables.filter((t) => t.sessionId).length,
      topItems: [...byItem.values()].sort((a, b) => b.qty - a.qty).slice(0, 6),
      byHour,
    };
  }
}

export const store = new Store(config.dataFile);
