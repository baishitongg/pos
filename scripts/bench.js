// Load test: simulates many guests browsing the menu and placing orders.
// Usage: start a server with rate limits relaxed (they would otherwise block a
// single-IP benchmark, which is the point of them), then:
//   RATE_LIMIT_MULTIPLIER=1000 LOG_REQUESTS=0 DATA_FILE=/tmp/bench.json PORT=3099 npm start
//   BASE=http://localhost:3099 npm run bench
const BASE = process.env.BASE || 'http://localhost:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY) || 100;
const SECONDS = Number(process.env.SECONDS) || 8;

const { tables } = await (await fetch(`${BASE}/api/demo/tables`)).json();
const tokens = tables.map((t) => t.path.split('/')[2]);

const scenarios = {
  'GET /api/menu (guest opens menu)': () => fetch(`${BASE}/api/menu`, { headers: { 'Accept-Encoding': 'br' } }),
  'GET /api/t/:token (table + orders)': () => fetch(`${BASE}/api/t/${tokens[Math.floor(Math.random() * tokens.length)]}`),
  'POST orders (place order)': () => fetch(`${BASE}/api/t/${tokens[Math.floor(Math.random() * tokens.length)]}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ items: [{ itemId: 'truffle-fries', qty: 1 }, { itemId: 'teh-tarik', qty: 2, optionIds: ['temp:hot', 'sugar:less'] }] }),
  }),
};

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

for (const [name, fn] of Object.entries(scenarios)) {
  const lat = [];
  let errors = 0;
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < end) {
      const t0 = performance.now();
      try {
        const res = await fn();
        await res.arrayBuffer();
        if (!res.ok && res.status !== 304) errors++;
      } catch { errors++; }
      lat.push(performance.now() - t0);
    }
  }));
  lat.sort((a, b) => a - b);
  console.log(`\n${name}`);
  console.log(`  ${(lat.length / SECONDS).toFixed(0)} req/s   p50 ${pct(lat, 50).toFixed(1)}ms   p95 ${pct(lat, 95).toFixed(1)}ms   p99 ${pct(lat, 99).toFixed(1)}ms   errors ${errors}/${lat.length}`);
}
