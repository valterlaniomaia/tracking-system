import { config } from '../../config.js';
import { JsonStore } from './json-store.js';

let storeInstance = null;

/**
 * Get the legacy single-store instance (backward compatibility).
 * For multi-store, use store-registry.getContext(storeId).clients.orderStore
 */
export async function getStore() {
  if (storeInstance) return storeInstance;

  // Try multi-store first: load zaprada from data/orders/
  try {
    const { getContext } = await import('../multi-store/store-registry.js');
    const ctx = getContext(); // default store
    storeInstance = ctx.clients.orderStore;
    return storeInstance;
  } catch {
    // Fallback: legacy single-store
    switch (config.store.type) {
      case 'json':
      default:
        storeInstance = new JsonStore(config.store.jsonPath);
        await storeInstance.init();
        return storeInstance;
    }
  }
}
