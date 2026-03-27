import express from 'express';
import { config } from './config.js';
import { handleParcelPanelWebhook, handleShopifyWebhook, processTrackingUpdate, getLastWebhookAt } from './src/webhook/handler.js';
import { buildEvent } from './src/klaviyo/events.js';
import { sendEvent } from './src/klaviyo/client.js';
import { startPolling, getLastPollAt, getPollStats } from './src/polling/poller.js';
import { getStore } from './src/store/index.js';
import { createLogger } from './src/utils/logger.js';

// Multi-store imports
import { loadStoresConfig } from './src/multi-store/store-config.js';
import { initRegistry, getContext, getRegisteredStoreIds } from './src/multi-store/store-registry.js';

const log = createLogger('server');
const app = express();
const startedAt = new Date().toISOString();

// Parse JSON body and capture raw body for HMAC verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf-8');
    },
  })
);

// ── Webhook Endpoints ──

// Legacy (backward compat): /webhook/parcelpanel → default store
app.post('/webhook/parcelpanel', handleParcelPanelWebhook);

// Multi-store: /webhook/parcelpanel/:storeId
app.post('/webhook/parcelpanel/:storeId', handleParcelPanelWebhook);

app.post('/webhook/shopify', handleShopifyWebhook);

// ── Health Endpoints ──

app.get('/health', async (_req, res) => {
  const store = await getStore();
  const storeIds = getRegisteredStoreIds();
  res.json({
    status: 'ok',
    version: '2.0.0',
    uptime: process.uptime(),
    startedAt,
    multiStore: { enabled: true, stores: storeIds },
    storeCount: await store.count(),
    lastPollAt: getLastPollAt(),
    lastWebhookAt: getLastWebhookAt(),
  });
});

app.get('/health/detail', async (_req, res) => {
  const store = await getStore();
  const storeIds = getRegisteredStoreIds();

  // Per-store stats
  const storesDetail = {};
  for (const id of storeIds) {
    try {
      const ctx = getContext(id);
      const s = ctx.clients.orderStore;
      storesDetail[id] = {
        orderCount: await s.count(),
        ordersByStatus: await s.countByStatus(),
      };
    } catch {
      storesDetail[id] = { error: 'failed to load' };
    }
  }

  res.json({
    status: 'ok',
    version: '2.0.0',
    uptime: process.uptime(),
    startedAt,
    multiStore: { enabled: true, stores: storeIds, detail: storesDetail },
    storeCount: await store.count(),
    ordersByStatus: await store.countByStatus(),
    lastPollAt: getLastPollAt(),
    lastWebhookAt: getLastWebhookAt(),
    pollStats: getPollStats(),
    config: {
      pollingIntervalMs: config.polling.intervalMs,
      pollingOrdersDays: config.polling.ordersDays,
      noUpdateThresholds: config.thresholds,
    },
  });
});

// ── Test Endpoints ──

// Send a test event to Klaviyo (validates API key + connection)
app.post('/test/klaviyo', async (req, res) => {
  const email = req.body.email || 'test@example.com';
  const storeId = req.body.storeId || null;
  try {
    let apiKey = null;
    try {
      const ctx = getContext(storeId);
      apiKey = ctx.clients.klaviyoApiKey;
    } catch { /* use global fallback */ }

    const payload = buildEvent({
      email,
      mappedStatus: 'in_transit_china',
      orderId: 'TEST-' + Date.now(),
      orderNumber: '#TEST',
      trackingNumber: 'TEST123',
      trackingUrl: '',
      rawStatus: 'IN_TRANSIT',
      description: 'Test event from tracking system',
      daysSinceShipped: 1,
    });
    await sendEvent(payload, apiKey);
    res.json({ success: true, message: 'Klaviyo event sent', email, storeId: storeId || 'default' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simulate a webhook with custom data
app.post('/test/simulate', async (req, res) => {
  const { order_id, email, tracking_number, status, checkpoints, fulfilled_at } = req.body;
  if (!order_id || !email) {
    return res.status(400).json({ error: 'order_id and email are required' });
  }
  try {
    await processTrackingUpdate({
      orderId: order_id,
      orderNumber: req.body.order_number || '',
      email,
      trackingNumber: tracking_number || '',
      trackingUrl: req.body.tracking_url || '',
      rawStatus: status || 'PENDING',
      substatus: req.body.substatus || '',
      checkpoints: checkpoints || [],
      fulfillmentDate: fulfilled_at || new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    const store = await getStore();
    const order = await store.get(order_id);
    res.json({ success: true, orderState: order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// View a specific order's state
app.get('/test/order/:orderId', async (req, res) => {
  const store = await getStore();
  const order = await store.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ── Start ──

async function start() {
  // Initialize multi-store
  if (config.multiStore.enabled) {
    try {
      loadStoresConfig(config.multiStore.configPath);
      await initRegistry();
      log.info('Multi-store registry initialized');
    } catch (err) {
      log.error('Failed to init multi-store, falling back to legacy', { error: err.message });
    }
  }

  // Initialize legacy store (backward compat — uses multi-store if available)
  await getStore();
  log.info('Store initialized');

  // Start Express
  app.listen(config.server.port, () => {
    log.info(`Tracking system v2.0.0 running on port ${config.server.port}`);
    log.info('Endpoints:', {
      webhooks: ['/webhook/parcelpanel', '/webhook/parcelpanel/:storeId', '/webhook/shopify'],
      health: ['/health', '/health/detail'],
    });
  });

  // Start polling
  if (config.shopify.clientId && config.shopify.clientSecret) {
    startPolling();
  } else {
    log.warn('Shopify credentials not configured. Polling disabled.');
  }
}

start().catch((err) => {
  log.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
