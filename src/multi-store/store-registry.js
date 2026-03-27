import { getStoreConfig, getAllStoreIds, getDefaultStoreId } from './store-config.js';
import { createOrderStore } from '../store/order/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('store-registry');

/**
 * StoreContext — resolved per-store object with separated config sections + initialized clients.
 *
 * {
 *   storeId: string,
 *   branding: { storeName, supportEmail, supportName, tone, language, signoff },
 *   policy: { deliveryEstimate, refundPolicy, ... },
 *   aiConfig: { mode, autoRespondEnabled, emergencyStop, maxDailyResponses },
 *   clients: { orderStore, klaviyoApiKey, shopifyConfig, ... }
 * }
 */

const registry = new Map();
let defaultStoreId = null;

/**
 * Initialize all stores from config.
 */
export async function initRegistry() {
  const storeIds = getAllStoreIds();
  defaultStoreId = getDefaultStoreId();

  log.info(`Initializing registry for ${storeIds.length} store(s). Default: ${defaultStoreId}`);

  for (const storeId of storeIds) {
    await initStore(storeId);
  }

  return registry;
}

/**
 * Initialize a single store context.
 */
async function initStore(storeId) {
  const cfg = getStoreConfig(storeId);

  // Create order store (JSON file per store)
  const orderStore = await createOrderStore({
    type: 'json',
    path: `./data/orders/${storeId}.json`,
  });

  const context = {
    storeId,

    // ── Config Sections (flat access) ──
    branding: cfg.branding || {},
    policy: cfg.policy || {},
    aiConfig: cfg.ai || { mode: 'suggest', autoRespondEnabled: false, emergencyStop: false },

    // ── Polling/Thresholds (merged with defaults) ──
    polling: cfg.polling || {},
    thresholds: cfg.thresholds || {},

    // ── Clients (resolved with credentials) ──
    clients: {
      orderStore,
      klaviyoApiKey: cfg.klaviyo?.privateKey || '',
      shopifyConfig: {
        storeDomain: cfg.shopify?.storeDomain || cfg.domain || '',
        clientId: cfg.shopify?.clientId || '',
        clientSecret: cfg.shopify?.clientSecret || '',
      },
      parcelpanelSecret: cfg.parcelpanel?.webhookSecret || '',
      // conversationStore: null,  // Initialized in Fase 1
      // emailProvider: null,      // Initialized in Fase 2
    },
  };

  registry.set(storeId, context);
  log.info(`Store "${storeId}" initialized (${await orderStore.count()} orders)`);

  return context;
}

/**
 * Get store context by ID. If no ID provided, returns default store.
 */
export function getContext(storeId) {
  const id = storeId || defaultStoreId;
  if (!id) throw new Error('No store ID provided and no default store configured.');

  const ctx = registry.get(id);
  if (!ctx) throw new Error(`Store "${id}" not found in registry.`);

  return ctx;
}

/**
 * Get all registered store IDs.
 */
export function getRegisteredStoreIds() {
  return Array.from(registry.keys());
}

/**
 * Get default store ID.
 */
export function getDefaultStore() {
  return defaultStoreId;
}

/**
 * Check if a store exists in the registry.
 */
export function hasStore(storeId) {
  return registry.has(storeId);
}
