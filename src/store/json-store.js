import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { StoreInterface } from './store-interface.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('json-store');

export class JsonStore extends StoreInterface {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.orders = new Map();
    this.dirty = false;
    this.saveTimer = null;
  }

  async init() {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [key, val] of Object.entries(parsed)) {
        this.orders.set(key, val);
      }
      log.info(`Loaded ${this.orders.size} orders from disk`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        await mkdir(dirname(this.filePath), { recursive: true });
        log.info('No existing store file, starting fresh');
      } else {
        log.error('Failed to load store', { error: err.message });
      }
    }
  }

  async get(orderId) {
    return this.orders.get(String(orderId)) || null;
  }

  async set(orderId, orderState) {
    const id = String(orderId);
    const existing = this.orders.get(id);
    const now = new Date().toISOString();

    this.orders.set(id, {
      ...existing,
      ...orderState,
      orderId: id,
      updatedAt: now,
      createdAt: existing?.createdAt || now,
      eventsSent: orderState.eventsSent || existing?.eventsSent || [],
    });

    this.scheduleSave();
  }

  async getByStatus(status) {
    const results = [];
    for (const order of this.orders.values()) {
      if (order.currentStatus === status) results.push(order);
    }
    return results;
  }

  async getActive() {
    const terminal = new Set(['delivered']);
    const results = [];
    for (const order of this.orders.values()) {
      if (!terminal.has(order.currentStatus)) results.push(order);
    }
    return results;
  }

  async recordEvent(orderId, eventRecord) {
    const order = this.orders.get(String(orderId));
    if (!order) return;

    if (!order.eventsSent) order.eventsSent = [];
    order.eventsSent.push({
      ...eventRecord,
      sentAt: new Date().toISOString(),
    });
    order.updatedAt = new Date().toISOString();

    this.scheduleSave();
  }

  async save() {
    const obj = Object.fromEntries(this.orders);
    await writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
    this.dirty = false;
    log.debug(`Persisted ${this.orders.size} orders to disk`);
  }

  async count() {
    return this.orders.size;
  }

  async countByStatus() {
    const counts = {};
    for (const order of this.orders.values()) {
      counts[order.currentStatus] = (counts[order.currentStatus] || 0) + 1;
    }
    return counts;
  }

  scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      if (this.dirty) {
        try {
          await this.save();
        } catch (err) {
          log.error('Failed to persist store', { error: err.message });
        }
      }
    }, 5000);
  }
}
