// Server-Sent Events hub: pushes order/menu updates to kitchen screens and
// guests' phones instead of having thousands of phones poll the API.
// Multi-instance deploys: fan out via Redis pub/sub (see docs/ARCHITECTURE.md).
import { config } from './config.js';

class Hub {
  constructor() {
    this.channels = new Map(); // channel -> Set<res>
    this.total = 0;
    this.perIp = new Map();
    setInterval(() => this.broadcastRaw(': ping\n\n'), 25_000).unref();
  }

  canAccept(ip) {
    return this.total < config.limits.maxSseClients && (this.perIp.get(ip) || 0) < config.limits.maxSsePerIp;
  }

  subscribe(req, res, channels, ip) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    for (const ch of channels) {
      if (!this.channels.has(ch)) this.channels.set(ch, new Set());
      this.channels.get(ch).add(res);
    }
    this.total++;
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    req.on('close', () => {
      for (const ch of channels) {
        const set = this.channels.get(ch);
        if (set) { set.delete(res); if (!set.size) this.channels.delete(ch); }
      }
      this.total--;
      const n = (this.perIp.get(ip) || 1) - 1;
      n ? this.perIp.set(ip, n) : this.perIp.delete(ip);
    });
  }

  publish(channel, event, data) {
    const set = this.channels.get(channel);
    if (!set) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(msg);
  }

  broadcastRaw(msg) {
    const seen = new Set();
    for (const set of this.channels.values()) for (const res of set) {
      if (!seen.has(res)) { seen.add(res); res.write(msg); }
    }
  }

  closeAll() {
    for (const set of this.channels.values()) for (const res of set) res.end();
    this.channels.clear();
  }
}

export const hub = new Hub();
