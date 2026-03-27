import 'dotenv/config';

function env(key, fallback) {
  return process.env[key] || fallback;
}

function envInt(key, fallback) {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config = {
  shopify: {
    storeDomain: env('SHOPIFY_STORE_DOMAIN', 'q1wpgq-qn.myshopify.com'),
    clientId: env('SHOPIFY_CLIENT_ID', ''),
    clientSecret: env('SHOPIFY_CLIENT_SECRET', ''),
    apiVersion: '2025-01',
  },

  klaviyo: {
    privateKey: env('KLAVIYO_PRIVATE_KEY', ''),
    apiRevision: '2024-10-15',
    baseUrl: 'https://a.klaviyo.com/api',
  },

  parcelpanel: {
    webhookSecret: env('PARCELPANEL_WEBHOOK_SECRET', ''),
  },

  server: {
    port: envInt('PORT', 3456),
    logLevel: env('LOG_LEVEL', 'info'),
  },

  polling: {
    intervalMs: envInt('POLLING_INTERVAL_MS', 1800000),
    ordersDays: envInt('POLLING_ORDERS_DAYS', 30),
  },

  thresholds: {
    noUpdateLevel1Hours: envInt('NO_UPDATE_LEVEL1_HOURS', 24),
    noUpdateLevel2Hours: envInt('NO_UPDATE_LEVEL2_HOURS', 72),
    noUpdateLevel3Hours: envInt('NO_UPDATE_LEVEL3_HOURS', 120),
    noUpdateExceptionHours: envInt('NO_UPDATE_EXCEPTION_HOURS', 168),
    stopTrackingAfterDays: envInt('STOP_TRACKING_AFTER_DAYS', 45),
  },

  retry: {
    maxAttempts: envInt('RETRY_MAX_ATTEMPTS', 3),
    baseDelayMs: envInt('RETRY_BASE_DELAY_MS', 1000),
  },

  store: {
    type: env('STORE_TYPE', 'json'),
    jsonPath: env('STORE_JSON_PATH', './data/order-states.json'),
  },

  multiStore: {
    enabled: env('MULTI_STORE_ENABLED', 'true') === 'true',
    configPath: env('STORES_CONFIG_PATH', './stores.json'),
  },

  statusToMetric: {
    no_update_yet: 'Tracking No Update Yet',
    in_transit_china: 'Tracking In Transit China',
    departed_origin: 'Tracking Departed Origin',
    arrived_us_hub: 'Tracking Arrived US Hub',
    in_transit_us: 'Tracking In Transit US',
    out_for_delivery: 'Tracking Out For Delivery',
    delivered: 'Tracking Delivered',
    exception: 'Tracking Exception',
  },

  statusOrder: [
    'no_update_yet',
    'in_transit_china',
    'departed_origin',
    'arrived_us_hub',
    'in_transit_us',
    'out_for_delivery',
    'delivered',
  ],
};
