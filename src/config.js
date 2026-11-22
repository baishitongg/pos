// Central configuration. Every value can be overridden with an environment
// variable (see .env.example). Nothing secret is hard-coded for production:
// the server refuses to start in production with the dev defaults.

const env = process.env;
const port = Number(env.PORT) || 3000;
const isProd = env.NODE_ENV === 'production';

const DEV_QR_SECRET = 'dev-only-qr-secret-change-me';

export const config = {
  isProd,
  port,
  host: env.HOST || '0.0.0.0',
  // Base URL printed into QR codes. Use your domain in production
  // (e.g. https://order.example.com) or your LAN IP to test with a phone.
  publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  trustProxy: env.TRUST_PROXY === '1',
  logRequests: env.LOG_REQUESTS !== '0',

  qrSecret: env.QR_SECRET || DEV_QR_SECRET,
  sessionTtlMs: (Number(env.SESSION_TTL_HOURS) || 12) * 3600_000,
  adminPassword: env.ADMIN_PASSWORD || 'admin123',
  kitchenPassword: env.KITCHEN_PASSWORD || 'kitchen123',

  dataFile: env.DATA_FILE || './data/db.json',

  // Rate limits (token buckets). Restaurant guests usually share ONE public
  // IP on the shop Wi-Fi, so per-IP limits are generous and the tight limits
  // are per table instead.
  rateLimitMultiplier: Number(env.RATE_LIMIT_MULTIPLIER) || 1,

  restaurant: {
    name: env.RESTAURANT_NAME || 'Hai Kitchen',
    currency: env.CURRENCY || 'MYR',
    locale: env.LOCALE || 'en-MY',
    timezone: env.TIMEZONE || 'Asia/Kuala_Lumpur',
    serviceChargeRate: env.SERVICE_CHARGE_RATE !== undefined ? Number(env.SERVICE_CHARGE_RATE) : 0.10,
    taxRate: env.TAX_RATE !== undefined ? Number(env.TAX_RATE) : 0.06,
    taxLabel: env.TAX_LABEL || 'SST',
  },

  limits: {
    maxLinesPerOrder: 30,
    maxQtyPerLine: 50,
    maxNoteLength: 140,
    maxOrderTotalCents: 500_000,
    maxSseClients: 5000,
    maxSsePerIp: 300,
  },
};

if (isProd) {
  const problems = [];
  if (config.qrSecret === DEV_QR_SECRET || config.qrSecret.length < 32) problems.push('QR_SECRET must be set to a random string of 32+ chars');
  if (config.adminPassword === 'admin123') problems.push('ADMIN_PASSWORD must be changed');
  if (config.kitchenPassword === 'kitchen123') problems.push('KITCHEN_PASSWORD must be changed');
  if (problems.length) {
    console.error('Refusing to start in production:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}
