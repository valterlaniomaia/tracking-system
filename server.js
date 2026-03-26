import express from 'express';
import { config } from './config.js';
import { handleParcelPanelWebhook, handleShopifyWebhook, processTrackingUpdate, getLastWebhookAt } from './src/webhook/handler.js';
import { buildEvent } from './src/klaviyo/events.js';
import { sendEvent } from './src/klaviyo/client.js';
import { startPolling, getLastPollAt, getPollStats } from './src/polling/poller.js';
import { getStore } from './src/store/index.js';
import { createLogger } from './src/utils/logger.js';

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

app.post('/webhook/parcelpanel', handleParcelPanelWebhook);
app.post('/webhook/shopify', handleShopifyWebhook);

// ── Health Endpoints ──

app.get('/health', async (_req, res) => {
  const store = await getStore();
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    startedAt,
    storeCount: await store.count(),
    lastPollAt: getLastPollAt(),
    lastWebhookAt: getLastWebhookAt(),
  });
});

app.get('/health/detail', async (_req, res) => {
  const store = await getStore();
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    startedAt,
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
  try {
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
    await sendEvent(payload);
    res.json({ success: true, message: 'Klaviyo event sent', email });
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
  // Initialize store
  await getStore();
  log.info('Store initialized');

  // Start Express
  app.listen(config.server.port, () => {
    log.info(`Tracking system running on port ${config.server.port}`);
    log.info('Endpoints:', {
      webhooks: ['/webhook/parcelpanel', '/webhook/shopify'],
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
