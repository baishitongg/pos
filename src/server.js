import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { config } from './config.js';
import { store } from './store.js';
import { hub } from './events.js';
import { buildOrder, publicOrder, TRANSITIONS } from './orders.js';
import * as sec from './security.js';
import { HttpError } from './security.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------------------------------------------------------------------------
// Static assets: loaded into memory and pre-compressed (brotli + gzip) once.
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function entity(body, type) {
  const etag = `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
  const compress = body.length > 512 && /text|json|javascript|svg|manifest/.test(type);
  return {
    type, etag, body,
    gz: compress ? zlib.gzipSync(body, { level: 9 }) : null,
    br: compress ? zlib.brotliCompressSync(body) : null,
  };
}

const assets = new Map();
(function load(dir, base) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = `${base}/${ent.name}`;
    if (ent.isDirectory()) load(full, rel);
    else assets.set(rel, entity(fs.readFileSync(full), MIME[path.extname(ent.name)] || 'application/octet-stream'));
  }
})(PUBLIC_DIR, '');

function sendEntity(req, res, ent, cache = 'no-cache') {
  const headers = { ETag: ent.etag, 'Cache-Control': cache, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, headers); return res.end(); }
  const ae = req.headers['accept-encoding'] || '';
  let body = ent.body;
  if (ent.br && /\bbr\b/.test(ae)) { body = ent.br; headers['Content-Encoding'] = 'br'; }
  else if (ent.gz && /\bgzip\b/.test(ae)) { body = ent.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Type'] = ent.type;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function json(req, res, status, data, extraHeaders = {}) {
  let body = Buffer.from(JSON.stringify(data));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...extraHeaders };
  if (body.length > 1400 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body, { level: 4 });
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return reject(new HttpError(415, 'json_required'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'payload_too_large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(new HttpError(400, 'invalid_json')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Rate limiters (capacity, refill per second)
// ---------------------------------------------------------------------------
const limit = {
  ip: new sec.RateLimiter(600, 20),               // whole restaurant may share one Wi-Fi IP
  orderTable: new sec.RateLimiter(6, 1 / 20),     // 6 burst, then 3 orders/min per table
  orderIp: new sec.RateLimiter(60, 1),
  request: new sec.RateLimiter(2, 1 / 30),        // call-waiter spam guard, per table+type
  login: new sec.RateLimiter(5, 1 / 60),          // 5 tries, then 1/min per ip+user
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  routes.push({ method, re, keys, handler });
}

function requireStaff(req, roles = ['admin', 'kitchen']) {
  const s = sec.getSession(req);
  if (!s) throw new HttpError(401, 'unauthenticated');
  if (!roles.includes(s.role)) throw new HttpError(403, 'forbidden');
  return s;
}

function tableFromToken(raw) {
  let token;
  try { token = decodeURIComponent(raw); } catch { throw new HttpError(404, 'invalid_table'); }
  const parsed = sec.parseTableToken(token);
  const table = parsed && store.table(parsed.tableId);
  if (!table || table.v !== parsed.v || !table.active) throw new HttpError(404, 'invalid_table');
  return table;
}

const tableUrl = (t) => `${config.publicUrl}/t/${sec.makeTableToken(t)}`;
const publicTable = (t) => ({ id: t.id, name: t.name });
const adminTable = (t) => ({ ...publicTable(t), v: t.v, active: t.active, open: !!t.sessionId, url: tableUrl(t), orders: store.sessionOrders(t).length });

function publishOrder(o) {
  hub.publish('staff', 'order', publicOrder(o));
  hub.publish(`table:${o.tableId}`, 'order', publicOrder(o));
}

// ---- health -----------------------------------------------------------------
route('GET', '/healthz', (req, res) => json(req, res, 200, { ok: true, uptime: Math.round(process.uptime()) }));
route('GET', '/readyz', (req, res) => json(req, res, store.ready && !shuttingDown ? 200 : 503, { ready: store.ready && !shuttingDown }));

// ---- public / guest ---------------------------------------------------------
route('GET', '/api/config', (req, res) => json(req, res, 200, config.restaurant, { 'Cache-Control': 'public, max-age=300' }));
route('GET', '/api/menu', (req, res) => sendEntity(req, res, store.menuEntity(), 'no-cache'));

route('GET', '/api/t/:token', (req, res, p) => {
  const table = tableFromToken(p.token);
  json(req, res, 200, { table: publicTable(table), orders: store.sessionOrders(table).map(publicOrder) });
});

route('POST', '/api/t/:token/orders', async (req, res, p) => {
  const table = tableFromToken(p.token);
  const ip = sec.clientIp(req);
  const key = req.headers['idempotency-key'];
  if (key !== undefined && !/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new HttpError(400, 'invalid_idempotency_key');
  const body = await readJson(req);

  // From here on the code is synchronous, so the duplicate check and the
  // insert cannot interleave with another request for the same key.
  const idemKey = key ? `${table.id}:${key}` : null;
  const existing = idemKey && store.findIdempotent(idemKey);
  if (existing) return json(req, res, 200, { order: publicOrder(existing), replay: true });
  if (!limit.orderTable.take(table.id) || !limit.orderIp.take(ip)) throw new HttpError(429, 'too_many_orders');

  const draft = buildOrder(body, store);
  const order = store.createOrder(table, draft, idemKey);
  publishOrder(order);
  json(req, res, 201, { order: publicOrder(order) });
});

route('POST', '/api/t/:token/requests', async (req, res, p) => {
  const table = tableFromToken(p.token);
  const { type } = await readJson(req);
  if (!['waiter', 'bill', 'water'].includes(type)) throw new HttpError(400, 'invalid_request_type');
  if (!limit.request.take(`${table.id}:${type}`)) throw new HttpError(429, 'already_requested');
  const r = store.addRequest(table, type);
  hub.publish('staff', 'request', r);
  json(req, res, 201, { ok: true });
});

route('GET', '/api/t/:token/stream', (req, res, p) => {
  const table = tableFromToken(p.token);
  const ip = sec.clientIp(req);
  if (!hub.canAccept(ip)) throw new HttpError(503, 'too_many_streams');
  hub.subscribe(req, res, [`table:${table.id}`, 'public'], ip);
});

// ---- auth ---------------------------------------------------------------------
route('POST', '/api/auth/login', async (req, res) => {
  const { username, password } = await readJson(req);
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) throw new HttpError(400, 'invalid_credentials');
  if (!limit.login.take(`${sec.clientIp(req)}|${username.toLowerCase()}`)) throw new HttpError(429, 'too_many_attempts');
  const user = store.userByName(username);
  const ok = sec.verifyPassword(password, user ? user.hash : sec.DUMMY_HASH) && !!user;
  if (!ok) throw new HttpError(401, 'invalid_credentials');
  const sid = sec.createSession(user);
  json(req, res, 200, { user: { username: user.username, role: user.role } }, { 'Set-Cookie': sec.sessionCookie(req, sid, config.sessionTtlMs) });
});

route('POST', '/api/auth/logout', (req, res) => {
  sec.destroySession(req);
  json(req, res, 200, { ok: true }, { 'Set-Cookie': sec.sessionCookie(req, '', 0) });
});

route('GET', '/api/auth/me', (req, res) => {
  const s = requireStaff(req);
  json(req, res, 200, { user: { username: s.username, role: s.role } });
});

// ---- staff (kitchen + admin) ----------------------------------------------------
route('GET', '/api/staff/orders', (req, res) => {
  requireStaff(req);
  const scope = new URL(req.url, 'http://x').searchParams.get('scope');
  const list = scope === 'today' ? store.ordersToday() : store.activeOrders();
  json(req, res, 200, { orders: list.map(publicOrder) });
});

route('PATCH', '/api/staff/orders/:id', async (req, res, p) => {
  const s = requireStaff(req);
  const order = store.order(p.id);
  if (!order) throw new HttpError(404, 'order_not_found');
  const { status } = await readJson(req);
  if (!TRANSITIONS[order.status]?.includes(status)) throw new HttpError(409, 'invalid_transition', { from: order.status, to: status });
  store.setOrderStatus(order, status, s.username);
  publishOrder(order);
  json(req, res, 200, { order: publicOrder(order) });
});

route('GET', '/api/staff/requests', (req, res) => {
  requireStaff(req);
  json(req, res, 200, { requests: store.openRequests() });
});

route('POST', '/api/staff/requests/:id/resolve', (req, res, p) => {
  requireStaff(req);
  const r = store.resolveRequest(p.id);
  if (!r) throw new HttpError(404, 'not_found');
  hub.publish('staff', 'request', r);
  json(req, res, 200, { ok: true });
});

route('GET', '/api/staff/stream', (req, res) => {
  requireStaff(req);
  const ip = sec.clientIp(req);
  if (!hub.canAccept(ip)) throw new HttpError(503, 'too_many_streams');
  hub.subscribe(req, res, ['staff', 'public'], ip);
});

// ---- admin ------------------------------------------------------------------------
route('GET', '/api/admin/stats', (req, res) => {
  requireStaff(req, ['admin']);
  json(req, res, 200, store.stats());
});

route('PATCH', '/api/admin/items/:id', async (req, res, p) => {
  requireStaff(req, ['admin']);
  const body = await readJson(req);
  const patch = {};
  if ('available' in body) {
    if (typeof body.available !== 'boolean') throw new HttpError(400, 'invalid_available');
    patch.available = body.available;
  }
  if ('price' in body) {
    if (!Number.isInteger(body.price) || body.price < 0 || body.price > 1_000_000) throw new HttpError(400, 'invalid_price');
    patch.price = body.price;
  }
  const item = store.updateItem(p.id, patch);
  if (!item) throw new HttpError(404, 'item_not_found');
  hub.publish('public', 'menu', { version: store.state.menuVersion, itemId: item.id, available: item.available });
  json(req, res, 200, { item });
});

route('GET', '/api/admin/tables', (req, res) => {
  requireStaff(req, ['admin']);
  json(req, res, 200, { tables: store.tables().map(adminTable) });
});

route('POST', '/api/admin/tables', async (req, res) => {
  requireStaff(req, ['admin']);
  const { name } = await readJson(req);
  if (name !== undefined && (typeof name !== 'string' || name.trim().length > 40)) throw new HttpError(400, 'invalid_name');
  const t = store.addTable(name?.trim());
  json(req, res, 201, { table: adminTable(t) });
});

route('POST', '/api/admin/tables/:id/rotate', (req, res, p) => {
  requireStaff(req, ['admin']);
  const t = store.table(p.id);
  if (!t) throw new HttpError(404, 'table_not_found');
  store.rotateTable(t);
  hub.publish(`table:${t.id}`, 'invalidated', {});
  json(req, res, 200, { table: adminTable(t) });
});

route('POST', '/api/admin/tables/:id/close', (req, res, p) => {
  requireStaff(req, ['admin']);
  const t = store.table(p.id);
  if (!t) throw new HttpError(404, 'table_not_found');
  const orders = store.closeTableSession(t);
  for (const o of orders) hub.publish('staff', 'order', publicOrder(o));
  hub.publish(`table:${t.id}`, 'session_closed', {});
  json(req, res, 200, { table: adminTable(t), closedOrders: orders.length });
});

route('GET', '/api/admin/tables/:id/qr.svg', async (req, res, p) => {
  requireStaff(req, ['admin']);
  const t = store.table(p.id);
  if (!t) throw new HttpError(404, 'table_not_found');
  const svg = await QRCode.toString(tableUrl(t), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-cache' });
  res.end(svg);
});

// Demo helper: lists table links on the landing page. Disabled in production
// so nobody can order for a table without physically scanning its QR.
route('GET', '/api/demo/tables', (req, res) => {
  if (config.isProd) throw new HttpError(404, 'not_found');
  json(req, res, 200, { tables: store.tables().slice(0, 6).map((t) => ({ name: t.name, path: `/t/${sec.makeTableToken(t)}` })) });
});

// ---- pages ----------------------------------------------------------------------
const page = (file) => (req, res) => sendEntity(req, res, assets.get(file));
route('GET', '/', page('/index.html'));
route('GET', '/t/:token', page('/order.html'));
route('GET', '/kitchen', page('/kitchen.html'));
route('GET', '/admin', page('/admin.html'));
route('GET', '/login', page('/login.html'));

// ---------------------------------------------------------------------------
// Request pipeline
// ---------------------------------------------------------------------------
let shuttingDown = false;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function handle(req, res) {
  const started = performance.now();
  sec.securityHeaders(req, res);
  const url = req.url || '/';
  const pathname = url.split('?')[0];
  if (config.logRequests && !pathname.endsWith('/stream')) {
    res.once('finish', () => console.log(`${req.method} ${pathname.slice(0, 60)} ${res.statusCode} ${(performance.now() - started).toFixed(1)}ms`));
  }
  try {
    if (pathname.length > 512) throw new HttpError(414, 'uri_too_long');
    if (!pathname.startsWith('/healthz') && !limit.ip.take(sec.clientIp(req))) throw new HttpError(429, 'rate_limited');

    // CSRF: mutating API calls must come from our own pages (custom header
    // forces a CORS preflight that we never approve) and a matching Origin.
    if (MUTATING.has(req.method)) {
      if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'csrf');
      const origin = req.headers.origin;
      if (origin) {
        let host = null;
        try { host = new URL(origin).host; } catch {}
        if (host !== req.headers.host) throw new HttpError(403, 'bad_origin');
      }
    }

    const method = req.method === 'HEAD' ? 'GET' : req.method;
    let matched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      matched = true;
      if (r.method !== method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      await r.handler(req, res, params);
      return;
    }
    if (method === 'GET' && assets.has(pathname) && !pathname.endsWith('.html')) return sendEntity(req, res, assets.get(pathname));
    throw new HttpError(matched ? 405 : 404, matched ? 'method_not_allowed' : 'not_found');
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    if (err instanceof HttpError) json(req, res, err.status, { error: err.code, ...err.extra });
    else { console.error(err); json(req, res, 500, { error: 'internal_error' }); }
  }
}

store.load();
const server = http.createServer({ keepAliveTimeout: 65_000, requestTimeout: 15_000, headersTimeout: 10_000 }, handle);
server.listen(config.port, config.host, () => {
  console.log(`\n  ${config.restaurant.name} ordering server`);
  console.log(`  Landing (demo):  http://localhost:${config.port}/`);
  console.log(`  Kitchen display: http://localhost:${config.port}/kitchen`);
  console.log(`  Admin console:   http://localhost:${config.port}/admin`);
  console.log(`  QR base URL:     ${config.publicUrl}\n`);
});

// Graceful shutdown: stop taking traffic, flush data, then exit.
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${sig} received, shutting down`);
  hub.closeAll();
  server.close(() => { store.flushSync(); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => { store.flushSync(); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
