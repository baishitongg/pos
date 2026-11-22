// Order validation and pricing. The client never decides a price: every
// line is re-priced here from the server's menu.
import { HttpError } from './security.js';
import { config } from './config.js';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const OPT_RE = /^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,40}$/;
// Strip control characters and trim; notes are rendered with textContent on
// every screen, so no HTML is ever interpreted.
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

export function buildOrder(body, store) {
  const L = config.limits;
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new HttpError(400, 'invalid_order');
  if (body.items.length < 1 || body.items.length > L.maxLinesPerOrder) throw new HttpError(400, 'invalid_line_count');

  const payment = body.payment ?? 'counter';
  if (payment !== 'counter') throw new HttpError(400, 'unsupported_payment');

  const lines = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object' || typeof raw.itemId !== 'string' || !ID_RE.test(raw.itemId)) throw new HttpError(400, 'invalid_item');
    const qty = raw.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > L.maxQtyPerLine) throw new HttpError(400, 'invalid_qty');
    const optionIds = raw.optionIds ?? [];
    if (!Array.isArray(optionIds) || optionIds.length > 20 || !optionIds.every((o) => typeof o === 'string' && OPT_RE.test(o))) throw new HttpError(400, 'invalid_options');
    if (new Set(optionIds).size !== optionIds.length) throw new HttpError(400, 'duplicate_options');

    const item = store.item(raw.itemId);
    if (!item) throw new HttpError(400, 'item_not_found', { itemId: raw.itemId });
    if (!item.available) throw new HttpError(409, 'sold_out', { itemId: item.id });

    // optionIds are "<groupId>:<optionId>"
    const chosen = [];
    const used = new Set();
    for (const g of item.optionGroups) {
      const picks = g.options.filter((o) => optionIds.includes(`${g.id}:${o.id}`));
      if (picks.length < g.min || picks.length > g.max) throw new HttpError(400, 'invalid_option_count', { itemId: item.id, group: g.id });
      for (const o of picks) {
        used.add(`${g.id}:${o.id}`);
        chosen.push({ group: g.id, groupName: g.name, id: o.id, name: o.name, price: o.price });
      }
    }
    if (used.size !== optionIds.length) throw new HttpError(400, 'unknown_option', { itemId: item.id });

    const unitPrice = item.price + chosen.reduce((s, o) => s + o.price, 0);
    lines.push({
      itemId: item.id, name: item.name, emoji: item.emoji, qty, unitPrice,
      options: chosen, note: cleanText(raw.note, L.maxNoteLength), lineTotal: unitPrice * qty,
    });
  }

  const r = config.restaurant;
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const service = Math.round(subtotal * r.serviceChargeRate);
  const tax = Math.round((subtotal + service) * r.taxRate);
  const total = subtotal + service + tax;
  if (total > L.maxOrderTotalCents) throw new HttpError(400, 'order_too_large');

  return { items: lines, subtotal, service, tax, total, payment };
}

// Order status machine. Staff may step back once (undo a mis-tap).
export const TRANSITIONS = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'new', 'cancelled'],
  ready: ['served', 'preparing'],
  served: ['ready'],
  cancelled: ['new'],
};

export function publicOrder(o) {
  return {
    id: o.id, no: o.no, tableId: o.tableId, tableName: o.tableName, status: o.status, items: o.items,
    subtotal: o.subtotal, service: o.service, tax: o.tax, total: o.total, payment: o.payment, paid: o.paid,
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  };
}
