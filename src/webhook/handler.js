import { normalizeStatus } from '../normalizer/status-map.js';
import { buildEvent } from '../klaviyo/events.js';
import { sendEvent } from '../klaviyo/client.js';
import { getStore } from '../store/index.js';
import {
  shouldFireStatusEvent,
  shouldFireNoUpdateYet,
  generateUniqueId,
  shouldStopTracking,
} from '../rules/business-rules.js';
import { verifyParcelPanel, verifyShopify } from './validator.js';
import { config } from '../../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('webhook');

let lastWebhookAt = null;
export function getLastWebhookAt() {
  return lastWebhookAt;
}

/**
 * Resolve the order store and Klaviyo API key for a given storeId.
 * Falls back to defaults if storeId not provided or registry not available.
 */
async function resolveStoreContext(storeId) {
  try {
    const { getContext, hasStore } = await import('../multi-store/store-registry.js');
    if (storeId && hasStore(storeId)) {
      const ctx = getContext(storeId);
      return {
        store: ctx.clients.orderStore,
        klaviyoApiKey: ctx.clients.klaviyoApiKey,
        storeId,
      };
    }
    // No storeId or unknown → use default
    const ctx = getContext(); // default store
    return {
      store: ctx.clients.orderStore,
      klaviyoApiKey: ctx.clients.klaviyoApiKey,
      storeId: ctx.storeId,
    };
  } catch {
    // Registry not available → legacy fallback
    return {
      store: await getStore(),
      klaviyoApiKey: null, // will use config global
      storeId: null,
    };
  }
}

/**
 * Process a tracking update: normalize → check rules → send Klaviyo event.
 * @param {object} data - Tracking update data
 * @param {string} [storeId] - Store ID for multi-store routing
 */
async function processTrackingUpdate({
  orderId,
  orderNumber,
  email,
  trackingNumber,
  trackingUrl,
  rawStatus,
  substatus,
  checkpoints,
  fulfillmentDate,
}, storeId) {
  const ctx = await resolveStoreContext(storeId);
  const store = ctx.store;
  const klaviyoApiKey = ctx.klaviyoApiKey;

  // Normalize
  const { mappedStatus, description } = normalizeStatus({
    status: rawStatus,
    substatus,
    checkpoints,
    fulfillmentDate,
  });

  log.info('Status normalized', { orderId, rawStatus, mappedStatus, storeId: ctx.storeId });

  // Get or create order state
  let order = await store.get(orderId);
  if (!order) {
    order = {
      orderId,
      email,
      trackingNumber,
      orderNumber,
      trackingUrl,
      currentStatus: null,
      lastStatusAt: null,
      fulfillmentDate,
      eventsSent: [],
    };
  }

  // Update fields that may have been missing
  if (email) order.email = email;
  if (trackingUrl) order.trackingUrl = trackingUrl;
  if (orderNumber) order.orderNumber = orderNumber;

  // Check if we should stop tracking
  if (shouldStopTracking(order)) {
    log.info('Order tracking stopped', { orderId, status: order.currentStatus });
    return;
  }

  const daysSinceShipped = fulfillmentDate
    ? Math.floor((Date.now() - new Date(fulfillmentDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Handle no_update_yet separately
  if (mappedStatus === 'no_update_yet') {
    const { fire, level } = shouldFireNoUpdateYet(order);
    if (fire && order.email) {
      const metricName = config.statusToMetric.no_update_yet;
      const payload = buildEvent({
        email: order.email,
        mappedStatus,
        orderId,
        orderNumber: order.orderNumber,
        trackingNumber,
        trackingUrl: order.trackingUrl,
        rawStatus,
        description,
        daysSinceShipped,
        escalationLevel: level,
      });

      try {
        await sendEvent(payload, klaviyoApiKey);
        order.eventsSent = order.eventsSent || [];
        order.eventsSent.push({
          metricName,
          level,
          uniqueId: generateUniqueId(orderId, metricName, level),
          sentAt: new Date().toISOString(),
        });
      } catch (err) {
        log.error('Failed to send Klaviyo event, order state still saved', {
          orderId, metricName, error: err.message,
        });
      }
    }
    order.currentStatus = mappedStatus;
    order.lastStatusAt = new Date().toISOString();
    await store.set(orderId, order);
    return;
  }

  // Handle regular status transitions
  if (shouldFireStatusEvent(order, mappedStatus) && order.email) {
    const metricName = config.statusToMetric[mappedStatus];
    const payload = buildEvent({
      email: order.email,
      mappedStatus,
      orderId,
      orderNumber: order.orderNumber,
      trackingNumber,
      trackingUrl: order.trackingUrl,
      rawStatus,
      description,
      daysSinceShipped,
    });

    try {
      await sendEvent(payload, klaviyoApiKey);
      order.eventsSent = order.eventsSent || [];
      order.eventsSent.push({
        metricName,
        level: 0,
        uniqueId: generateUniqueId(orderId, metricName, 0),
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      log.error('Failed to send Klaviyo event, order state still saved', {
        orderId, metricName, error: err.message,
      });
    }
  }

  order.currentStatus = mappedStatus;
  order.lastStatusAt = new Date().toISOString();
  await store.set(orderId, order);
}

/**
 * Express handler for ParcelPanel webhooks.
 * Supports: /webhook/parcelpanel and /webhook/parcelpanel/:storeId
 */
export async function handleParcelPanelWebhook(req, res) {
  lastWebhookAt = new Date().toISOString();
  const storeId = req.params?.storeId || null;

  // Resolve webhook secret for this store
  let webhookSecret = config.parcelpanel.webhookSecret;
  try {
    const { getContext } = await import('../multi-store/store-registry.js');
    const ctx = getContext(storeId);
    if (ctx.clients.parcelpanelSecret) {
      webhookSecret = ctx.clients.parcelpanelSecret;
    }
  } catch { /* use global fallback */ }

  const signature = req.headers['x-parcelpanel-hmac-sha256'] || req.headers['x-pp-hmac-sha256'] || '';
  if (!verifyParcelPanel(req.rawBody || '', signature, webhookSecret)) {
    log.warn('Invalid ParcelPanel webhook signature', { storeId });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({ received: true });

  try {
    const body = req.body;
    const data = body.data || body;

    const orderId = String(data.order_id || data.orderId || '');
    const email = data.customer?.email || data.email || '';
    const trackingNumber = data.tracking_number || data.trackingNumber || '';
    const rawStatus = data.status || '';
    const substatus = data.substatus || '';
    const checkpoints = data.checkpoints || data.tracking_details || [];
    const fulfillmentDate = data.fulfilled_at || data.fulfillment_date || data.created_at || '';
    const trackingUrl = data.tracking_url || data.tracking_link || '';
    const orderNumber = data.order_number || '';

    if (!orderId) {
      log.warn('Webhook missing order_id', { body: JSON.stringify(body).substring(0, 200) });
      return;
    }

    await processTrackingUpdate({
      orderId,
      orderNumber,
      email,
      trackingNumber,
      trackingUrl,
      rawStatus,
      substatus,
      checkpoints,
      fulfillmentDate,
    }, storeId);
  } catch (err) {
    log.error('Error processing ParcelPanel webhook', { error: err.message, stack: err.stack, storeId });
  }
}

/**
 * Express handler for Shopify fulfillment webhooks.
 */
export async function handleShopifyWebhook(req, res) {
  lastWebhookAt = new Date().toISOString();

  const hmac = req.headers['x-shopify-hmac-sha256'] || '';
  if (!verifyShopify(req.rawBody || '', hmac)) {
    log.warn('Invalid Shopify webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.status(200).json({ received: true });

  try {
    const body = req.body;
    const orderId = String(body.order_id || '');
    const trackingNumber = body.tracking_number || (body.tracking_numbers || [])[0] || '';
    const trackingUrl = body.tracking_url || (body.tracking_urls || [])[0] || '';
    const rawStatus = body.shipment_status || body.status || '';
    const fulfillmentDate = body.created_at || '';
    const email = body.email || body.destination?.email || '';

    if (!orderId) {
      log.warn('Shopify webhook missing order_id');
      return;
    }

    await processTrackingUpdate({
      orderId,
      orderNumber: '',
      email,
      trackingNumber,
      trackingUrl,
      rawStatus,
      substatus: '',
      checkpoints: [],
      fulfillmentDate,
    });
  } catch (err) {
    log.error('Error processing Shopify webhook', { error: err.message, stack: err.stack });
  }
}

export { processTrackingUpdate };
