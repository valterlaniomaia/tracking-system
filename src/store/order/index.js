import { JsonOrderStore } from './json-order-store.js';

/**
 * Factory: create an order store instance.
 * @param {Object} options - { type: 'json', path: './data/orders/zaprada.json' }
 */
export async function createOrderStore(options = {}) {
  const type = options.type || 'json';
  const path = options.path || './data/orders/default.json';

  if (type === 'json') {
    const store = new JsonOrderStore(path);
    await store.init();
    return store;
  }

  throw new Error(`Unknown order store type: ${type}`);
}
