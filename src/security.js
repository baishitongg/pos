import crypto from 'node:crypto';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------------------
// Table QR tokens:  <tableId>.<version>.<hmac>
// The HMAC stops guests from editing the URL to order for another table.
// Bumping the table version ("rotate QR") instantly invalidates old prints.
// ---------------------------------------------------------------------------
const hmac = (data) => crypto.createHmac('sha256', config.qrSecret).update(data).digest('base64url').slice(0, 22);

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function makeTableToken(table) {
  const body = `${table.id}.${table.v}`;
  return `${body}.${hmac(body)}`;
}

const TOKEN_RE = /^([A-Za-z0-9_-]{1,24})\.(\d{1,6})\.([A-Za-z0-9_-]{22})$/;
export function parseTableToken(token) {
  if (typeof token !== 'string' || token.length > 80) return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  if (!safeEqual(hmac(`${m[1]}.${m[2]}`), m[3])) return null;
  return { tableId: m[1], v: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Passwords (scrypt, per-user salt)
// ---------------------------------------------------------------------------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw, stored) {
  const [, saltB64, hashB64] = String(stored).split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}
// Used when the username does not exist so response time doesn't leak it.
export const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

// ---------------------------------------------------------------------------
// Staff sessions: opaque random id in an HttpOnly cookie; state server-side.
// (Production with several instances: move this Map to Redis.)
// ---------------------------------------------------------------------------
const sessions = new Map();

export function createSession(user) {
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions.set(sid, { userId: user.id, username: user.username, role: user.role, exp: Date.now() + config.sessionTtlMs });
  return sid;
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function getSession(req) {
  const sid = readCookie(req, 'sid');
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(sid); return null; }
  s.exp = Date.now() + config.sessionTtlMs; // sliding expiry
  return { ...s, sid };
}

export function destroySession(req) {
  const sid = readCookie(req, 'sid');
  if (sid) sessions.delete(sid);
}

export function sessionCookie(req, sid, maxAgeMs) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

// ---------------------------------------------------------------------------
// Token-bucket rate limiter (in-memory; Redis in a multi-instance deploy)
// ---------------------------------------------------------------------------
export class RateLimiter {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity * config.rateLimitMultiplier;
    this.refill = refillPerSec * config.rateLimitMultiplier;
    this.buckets = new Map();
    setInterval(() => this.sweep(), 60_000).unref();
  }
  take(key, cost = 1) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refill);
    b.at = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }
  sweep() {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now - b.at > 10 * 60_000) this.buckets.delete(k);
  }
}

export function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isHttps(req) {
  return req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https');
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
