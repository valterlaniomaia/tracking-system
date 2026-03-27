import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('store-config');

let storesConfig = null;

/**
 * Resolve ENV: references in config values to actual process.env values.
 */
function resolveEnvRefs(obj) {
  if (typeof obj === 'string' && obj.startsWith('ENV:')) {
    const envKey = obj.slice(4);
    const value = process.env[envKey];
    if (!value) {
      log.warn(`ENV var ${envKey} not found for config reference ${obj}`);
    }
    return value || '';
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvRefs);
  }
  if (obj && typeof obj === 'object') {
    const resolved = {};
    for (const [key, val] of Object.entries(obj)) {
      resolved[key] = resolveEnvRefs(val);
    }
    return resolved;
  }
  return obj;
}

/**
 * Load and parse stores.json, resolving ENV: references.
 */
export function loadStoresConfig(configPath) {
  const fullPath = resolve(configPath || './stores.json');
  log.info(`Loading stores config from ${fullPath}`);

  try {
    const raw = readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Resolve ENV: references in each store config
    const stores = {};
    for (const [storeId, storeConfig] of Object.entries(parsed.stores || {})) {
      stores[storeId] = resolveEnvRefs(storeConfig);
      stores[storeId]._storeId = storeId;
    }

    storesConfig = {
      stores,
      defaults: parsed.defaults || {},
    };

    const storeIds = Object.keys(stores);
    log.info(`Loaded ${storeIds.length} store(s): ${storeIds.join(', ')}`);

    return storesConfig;
  } catch (err) {
    log.error(`Failed to load stores config: ${err.message}`);
    throw err;
  }
}

/**
 * Get config for a specific store, merged with defaults.
 */
export function getStoreConfig(storeId) {
  if (!storesConfig) {
    throw new Error('Stores config not loaded. Call loadStoresConfig() first.');
  }
  const store = storesConfig.stores[storeId];
  if (!store) {
    throw new Error(`Store "${storeId}" not found in config.`);
  }

  // Merge store-level thresholds/polling with defaults
  return {
    ...store,
    polling: { ...storesConfig.defaults.polling, ...(store.polling || {}) },
    thresholds: { ...storesConfig.defaults.thresholds, ...(store.thresholds || {}) },
  };
}

/**
 * Get all configured store IDs.
 */
export function getAllStoreIds() {
  if (!storesConfig) return [];
  return Object.keys(storesConfig.stores);
}

/**
 * Get the default store ID (marked with default: true, or first store).
 */
export function getDefaultStoreId() {
  if (!storesConfig) return null;
  for (const [id, cfg] of Object.entries(storesConfig.stores)) {
    if (cfg.default) return id;
  }
  // Fallback: first store
  const ids = Object.keys(storesConfig.stores);
  return ids.length > 0 ? ids[0] : null;
}

/**
 * Get the global defaults config.
 */
export function getDefaults() {
  return storesConfig?.defaults || {};
}
