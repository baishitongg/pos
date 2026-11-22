# QR Table Ordering — prototype

Guests scan the QR code on their table, browse the menu on their phone, and order. Orders appear instantly on the kitchen display, and guests watch their order status live. Managers get a dashboard, live sold-out/price control and printable QR codes.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the design and how each quality attribute (performance, availability, scalability, security, usability) is handled.

## Run it

Requires Node.js 22.9+.

```bash
npm install
npm start
```

Open http://localhost:3000. In development the landing page lists demo table links (pretend you scanned a QR).

| Screen | URL | Demo login |
|---|---|---|
| Guest ordering | `/t/<table-token>` (from the QR) | none |
| Kitchen display | `/kitchen` | `kitchen` / `kitchen123` |
| Admin console | `/admin` | `admin` / `admin123` |

**Languages:** every screen supports English and 中文. It follows the phone or browser language on first visit, and the EN/中文 button switches it (remembered per device). Dish names show in both languages on the kitchen display. To add another language (e.g. Bahasa Melayu), add a `ms` block to each page's dictionary and a `ms` name to each menu item.

**Dish photos:** Admin → Menu → *Upload photo*. Photos are resized on the uploading device (max 1600 px, WebP/JPEG) before upload, then shown in the guest menu list and at the top of the dish details. Files are stored in `data/uploads/` (not committed to git).

**Test on a real phone:** set `PUBLIC_URL=http://<your-computer-LAN-IP>:3000` in `.env`, restart, open Admin → Tables & QR, and scan a code with a phone on the same Wi-Fi.

Other commands:

```bash
npm run dev      # auto-restart on file changes
npm run reset    # wipe data back to the demo menu
npm run bench    # load test (see header of scripts/bench.js)
```

## Project layout

```
src/server.js     HTTP server, routes, security pipeline, graceful shutdown
src/security.js   QR token signing, passwords, sessions, rate limiting, headers
src/store.js      data access (JSON file now → PostgreSQL later)
src/orders.js     validation, server-side pricing, order status machine
src/events.js     Server-Sent Events hub (live updates)
src/seed.js       demo menu and tables
public/           guest app (order.*), kitchen.*, admin.*, login.*, shared CSS/JS
db/schema.sql     PostgreSQL schema for production
```

## Production checklist
- Set `NODE_ENV=production`, a random `QR_SECRET`, and new staff passwords (the server refuses to start otherwise).
- Put it behind HTTPS on your domain and set `PUBLIC_URL` + `TRUST_PROXY=1`.
- Move data to PostgreSQL, and sessions/rate limits/live events to Redis, to run multiple instances.
