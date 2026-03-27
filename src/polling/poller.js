import { config } from '../../config.js';
import { getStore } from '../store/index.js';
import { getFulfilledOrders } from './shopify-client.js';
import {
  shouldFireNoUpdateYet,
  shouldTransitionToException,
  shouldStopTracking,
  generateUniqueId,
} from '../rules/business-rules.js';
import { buildEvent } from '../klaviyo/events.js';
import { sendEvent } from '../klaviyo/client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('poller');

let lastPollAt = null;
let pollStats = { ordersChecked: 0, eventsFired: 0, errors: 0 };

export function getLastPollAt() {
  return lastPollAt;
}
export function getPollStats() {
  return { ...pollStats };
}

/**
 * Poll a single store for fulfilled orders and process no_update_yet escalation.
 * @param {object} storeCtx - { orderStore, shopifyConfig, klaviyoApiKey, storeId }
 */
async function pollStore(storeCtx) {
  const { orderStore, shopifyConfig, klaviyoApiKey, storeId } = storeCtx;
  const pollingDays = config.polling.ordersDays;

  // Build shopify credentials for this store
  const creds = shopifyConfig.clientId && shopifyConfig.clientSecret
    ? { storeDomain: shopifyConfig.storeDomain, clientId: shopifyConfig.clientId, clientSecret: shopifyConfig.clientSecret }
    : null;

  if (!creds) {
    log.warn('Shopify credentials not configured for store, skipping poll', { storeId });
    return { checked: 0, fired: 0, errors: 0 };
  }

  let checked = 0, fired = 0, errors = 0;

  try {
    const shopifyOrders = await getFulfilledOrders(pollingDays, creds);

    for (const shopOrder of shopifyOrders) {
      checked++;

      try {
        let order = await orderStore.get(shopOrder.orderId);

        // New order — add to store
        if (!order) {
          order = {
            orderId: shopOrder.orderId,
            email: shopOrder.email,
            trackingNumber: shopOrder.trackingNumber,
            orderNumber: shopOrder.orderNumber,
            trackingUrl: shopOrder.trackingUrl,
            currentStatus: null,
            lastStatusAt: null,
            fulfillmentDate: shopOrder.fulfillmentDate,
            eventsSent: [],
          };
          await orderStore.set(shopOrder.orderId, order);
        }

        // Update email/tracking if missing
        if (!order.email && shopOrder.email) {
          order.email = shopOrder.email;
          await orderStore.set(order.orderId, order);
        }

        // Skip if we should stop tracking
        if (shouldStopTracking(order)) continue;
        if (order.currentStatus === 'delivered') continue;

        // Check for no_update_yet escalation
        if (!order.currentStatus || order.currentStatus === 'no_update_yet') {
          if (!order.currentStatus) {
            order.currentStatus = 'no_update_yet';
            order.lastStatusAt = new Date().toISOString();
            await orderStore.set(order.orderId, order);
          }

          // Check if should transition to exception
          if (shouldTransitionToException(order)) {
            const metricName = config.statusToMetric.exception;
            const uniqueId = generateUniqueId(order.orderId, metricName, 0);
            const alreadySent = order.eventsSent?.some((e) => e.uniqueId === uniqueId);

            if (!alreadySent && order.email) {
              const daysSinceShipped = Math.floor(
                (Date.now() - new Date(order.fulfillmentDate).getTime()) / (1000 * 60 * 60 * 24)
              );

              const payload = buildEvent({
                email: order.email,
                mappedStatus: 'exception',
                orderId: order.orderId,
                orderNumber: order.orderNumber,
                trackingNumber: order.trackingNumber,
                trackingUrl: order.trackingUrl,
                rawStatus: 'NO_UPDATE_TIMEOUT',
                description: `No tracking update for ${daysSinceShipped} days`,
                daysSinceShipped,
              });

              try {
                await sendEvent(payload, klaviyoApiKey);
                await orderStore.recordEvent(order.orderId, { metricName, level: 0, uniqueId });
                fired++;
              } catch (err) {
                log.error('Failed to send exception event', { orderId: order.orderId, storeId, error: err.message });
              }
              order.currentStatus = 'exception';
              await orderStore.set(order.orderId, order);
            }
            continue;
          }

          // Fire no_update_yet escalation
          const { fire, level } = shouldFireNoUpdateYet(order);
          if (fire && order.email) {
            const metricName = config.statusToMetric.no_update_yet;
            const uniqueId = generateUniqueId(order.orderId, metricName, level);
            const daysSinceShipped = Math.floor(
              (Date.now() - new Date(order.fulfillmentDate).getTime()) / (1000 * 60 * 60 * 24)
            );

            const payload = buildEvent({
              email: order.email,
              mappedStatus: 'no_update_yet',
              orderId: order.orderId,
              orderNumber: order.orderNumber,
              trackingNumber: order.trackingNumber,
              trackingUrl: order.trackingUrl,
              rawStatus: 'PENDING',
              description: `No tracking update for ${daysSinceShipped} days (level ${level})`,
              daysSinceShipped,
              escalationLevel: level,
            });

            try {
              await sendEvent(payload, klaviyoApiKey);
              await orderStore.recordEvent(order.orderId, { metricName, level, uniqueId });
              fired++;
            } catch (err) {
              log.error('Failed to send no_update_yet event', { orderId: order.orderId, storeId, error: err.message });
            }
          }
        }
      } catch (err) {
        errors++;
        log.error('Error processing order in poll', { orderId: shopOrder.orderId, storeId, error: err.message });
      }
    }
  } catch (err) {
    errors++;
    log.error('Failed to fetch orders from Shopify', { storeId, error: err.message });
  }

  return { checked, fired, errors };
}

async function pollOnce() {
  const startTime = Date.now();
  lastPollAt = new Date().toISOString();
  pollStats = { ordersChecked: 0, eventsFired: 0, errors: 0 };

  log.info('Polling cycle started');

  try {
    // Try multi-store polling
    const { getRegisteredStoreIds, getContext } = await import('../multi-store/store-registry.js');
    const storeIds = getRegisteredStoreIds();

    if (storeIds.length > 0) {
      for (const storeId of storeIds) {
        const ctx = getContext(storeId);
        log.info(`Polling store: ${storeId}`);

        const result = await pollStore({
          orderStore: ctx.clients.orderStore,
          shopifyConfig: ctx.clients.shopifyConfig,
          klaviyoApiKey: ctx.clients.klaviyoApiKey,
          storeId,
        });

        pollStats.ordersChecked += result.checked;
        pollStats.eventsFired += result.fired;
        pollStats.errors += result.errors;
      }
    } else {
      // Fallback: legacy single-store polling
      const store = await getStore();
      const result = await pollStore({
        orderStore: store,
        shopifyConfig: {
          storeDomain: config.shopify.storeDomain,
          clientId: config.shopify.clientId,
          clientSecret: config.shopify.clientSecret,
        },
        klaviyoApiKey: null, // uses global config
        storeId: 'default',
      });
      pollStats.ordersChecked = result.checked;
      pollStats.eventsFired = result.fired;
      pollStats.errors = result.errors;
    }

    const duration = Date.now() - startTime;
    log.info('Polling cycle completed', { ...pollStats, durationMs: duration });
  } catch (err) {
    log.error('Polling cycle failed', { error: err.message, stack: err.stack });
    pollStats.errors++;
  }
}

let pollInterval = null;

export function startPolling() {
  const intervalMs = config.polling.intervalMs;
  log.info(`Starting polling every ${intervalMs / 1000}s`);

  // Run first poll after 10 seconds
  setTimeout(() => pollOnce(), 10000);

  pollInterval = setInterval(() => pollOnce(), intervalMs);
}

export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    log.info('Polling stopped');
  }
}
