# QR Table Ordering — Architecture & Quality Attributes

## 1. What the system does

```
 Guest phone ──scan QR──▶ https://<domain>/t/<signed-table-token>
     │  browse menu · customise · place order · live status · call waiter / bill
     ▼
 ┌────────────────────────── Node.js app server ──────────────────────────┐
 │ Static pages (pre-compressed) · REST API · SSE push · auth · rate limit│
 └───────────────┬─────────────────────────────────────┬──────────────────┘
                 │ Store interface (src/store.js)      │ SSE "order"/"request"/"menu" events
                 ▼                                     ▼
   prototype: JSON file  →  production: PostgreSQL   Kitchen display (/kitchen)
                                                     Admin console (/admin)
```

| Actor | Screen | Main jobs |
|---|---|---|
| Guest | `/t/:token` (mobile web, no app install) | Menu (EN/中文), options & notes, cart, place order, live order tracker, call waiter / water / bill |
| Kitchen | `/kitchen` (tablet/TV) | New → Preparing → Ready → Served board, ticket ageing colours, sound alerts, service requests |
| Manager | `/admin` | Live sales dashboard, sold-out & price changes, tables & printable QR codes, close bill, rotate QR, order history |

**Why a web app and not a native app:** a QR scan must open instantly with zero install. The guest bundle is ~15 KB (brotli) with no framework.

## 2. Quality attributes — what's implemented now, and the production plan

### Performance (response time & throughput)
Measured on a laptop, single Node process, 100 concurrent clients (`npm run bench`):

| Endpoint | Throughput | p50 | p95 | p99 |
|---|---|---|---|---|
| `GET /api/menu` | ~12,000 req/s | 7 ms | 13 ms | 17 ms |
| `GET /api/t/:token` | ~20,500 req/s | 4 ms | 10 ms | 11 ms |
| `POST` order | ~6,300 orders/s accepted* | 7 ms | 16 ms | — |

\*the rest were deliberately rejected by the per-table spam limit.

A busy restaurant needs maybe 1–5 orders/second, so one instance handles a large chain.

Tactics:
- Menu is serialised **and brotli/gzip-compressed once per menu version**, served with an `ETag`, so repeat loads return `304` with no body.
- All static assets are held in memory, pre-compressed.
- **Server-Sent Events** push updates; phones never poll. One idle connection costs ~a few KB.
- Prices stored as integer cents (no floating-point errors, cheap maths).
- No front-end framework; system fonts; emoji artwork (zero image requests).
- Production: CDN in front of static assets + `/api/menu`, hashed asset filenames with `immutable` caching.

### Availability & reliability
- `GET /healthz` (liveness) and `GET /readyz` (readiness, goes 503 while shutting down) for a load balancer.
- Graceful shutdown on `SIGTERM`: stops accepting traffic, closes streams, flushes data.
- **Idempotency keys** on order submission: a guest on bad Wi-Fi can retry (or reload) and never gets a duplicate order. The key survives page reloads.
- Client retries transient errors with exponential backoff and jitter; the cart is saved on the phone, so a crash or drop loses nothing.
- SSE auto-reconnects and **re-syncs state on every reconnect**, so a missed event can't leave a stale screen.
- Atomic data writes (write temp file → rename): a crash mid-write can't corrupt data.
- Server timeouts (headers 10 s, request 15 s) protect against slow-client attacks.
- Production: ≥2 instances behind a load balancer across 2 zones, managed PostgreSQL with automatic failover and point-in-time recovery, Redis for sessions/pub-sub, uptime alerts. Target 99.9%.

### Scalability
- App servers are stateless except for three in-memory pieces, each with a drop-in replacement: **sessions → Redis**, **rate-limit buckets → Redis**, **SSE fan-out → Redis pub/sub (or Postgres LISTEN/NOTIFY)**. After that, scale horizontally behind the load balancer.
- All data access goes through `src/store.js`; `db/schema.sql` is the PostgreSQL schema with indexes for the hot queries (active orders, orders per table session, daily reports).
- Multi-outlet / multi-tenant: add `outlet_id` to every table (already in the schema) and include it in the QR token.
- SSE connection caps (total and per IP) stop one client from exhausting the server.

### Security
| Threat | Mitigation |
|---|---|
| Guest edits URL to order for another table | QR token is `tableId.version.HMAC-SHA256`; tampered tokens are rejected (constant-time compare) |
| QR photographed and abused from home | Admin **Rotate QR** bumps the version and instantly kills old codes; table sessions end at **Close bill**; per-table order rate limit |
| Price tampering | Client sends only item IDs, option IDs and quantities; **server re-prices everything** and validates option min/max |
| Order spam / bots | Token-bucket limits per table (orders, waiter calls) and generous per-IP limits (guests share the shop Wi-Fi IP), max lines/qty/order value |
| XSS via notes or item names | DOM built only with `textContent`; strict **Content-Security-Policy** (`script-src 'self'`, no inline scripts); control characters stripped |
| CSRF | `SameSite=Strict` cookies + required `X-Requested-With` header (forces a CORS preflight that's never approved) + `Origin` check |
| Staff password attacks | scrypt hashes with per-user salt; login limit per IP+username; same response time for unknown users |
| Session theft | Random 256-bit session IDs, `HttpOnly`, `Secure` on HTTPS, sliding 12 h expiry, server-side revocation on logout |
| Privilege escalation | Role checks on every staff endpoint (`kitchen` can't reach `/api/admin/*`) |
| Clickjacking, sniffing, referrer leaks | `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS on HTTPS |
| Oversized/malformed payloads | 16 KB body limit, JSON content-type required, strict schema validation |
| Insecure deploy | Server **refuses to start in production** with default secrets or passwords |
| Open redirect on login | `next` parameter restricted to same-site paths |
| Malicious file upload | Admin-only; JPG/PNG/WebP only, verified by file signature (not name or header); 5 MB cap; random content-hash file names (no path traversal); served with `nosniff` and a fixed image type |
| Demo table list leaks tokens | `/api/demo/tables` is disabled when `NODE_ENV=production` |

Production additions: TLS everywhere, WAF/CDN bot protection, secrets in a secret manager, payment via a PCI-compliant hosted gateway (we never touch card data), audit log, dependency scanning.

### Usability & accessibility
- Opens straight to the menu with the table already known: **no login, no app, no typing a table number**.
- Mobile-first: one-hand reach, sticky category chips with scroll-spy, sticky cart bar, bottom sheets, 44 px+ touch targets.
- Bilingual EN/中文 (auto-detected from the phone, one-tap toggle); easy to add Malay/Tamil.
- Clear status tracker (Received → Preparing → Ready → Served), vibration + toast when food is ready.
- Sold-out items update live on every phone and are removed from carts with an explanation.
- Price breakdown (subtotal, service charge, SST) shown before ordering, so there are no surprises.
- Native `<dialog>` gives focus trapping and Esc-to-close; ARIA tabs/live regions; visible focus rings; respects `prefers-reduced-motion` and dark mode.
- Kitchen display: high contrast, large type, ticket ageing colours (10 min amber / 15 min red), notes highlighted, one-tap advance with undo.

### Maintainability & operability
- Single dependency (`qrcode`); plain modern JavaScript (ES modules), no build step.
- Clear module split: `config` · `security` · `store` · `orders` (pricing/state machine) · `events` (SSE) · `server` (routing).
- Every setting comes from environment variables (`.env.example`).
- One log line per request with latency; production: structured logs + metrics (p95 latency, orders/min, SSE connections).

## 3. Order lifecycle

```
new ──▶ preparing ──▶ ready ──▶ served
 │  ◀──── (undo) ────┘ ◀─────────┘
 └──▶ cancelled
Table session: opens on the first order, ends when admin presses "Close bill" (orders marked paid).
```

## 4. Roadmap after the prototype
1. Connect PostgreSQL (`db/schema.sql`) and Redis; deploy on your domain with HTTPS.
2. Online payment (e.g. a local gateway with FPX / e-wallet / cards) and e-receipts.
3. Move menu photos (already uploadable in admin) to object storage + CDN; full menu editor (add/rename dishes, options).
4. Printer integration (ESC/POS kitchen and receipt printers), kitchen stations (drinks vs food).
5. Multi-outlet support, staff accounts management, reports export.
6. Offline-capable PWA (service worker) for flaky shop Wi-Fi.
