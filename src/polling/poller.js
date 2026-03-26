import { config } from '../../config.js';
import { getStore } from '../store/index.js';
import { getFulfilledOrders } from './shopify-client.js';
import { processTrackingUpdate } from '../webhook/handler.js';
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

async function pollOnce() {
  const startTime = Date.now();
  lastPollAt = new Date().toISOString();
  pollStats = { ordersChecked: 0, eventsFired: 0, errors: 0 };

  log.info('Polling cycle started');

  try {
    const store = await getStore();
    const shopifyOrders = await getFulfilledOrders(config.polling.ordersDays);

    for (const shopOrder of shopifyOrders) {
      pollStats.ordersChecked++;

      try {
        let order = await store.get(shopOrder.orderId);

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
          await store.set(shopOrder.orderId, order);
        }

        // Update email/tracking if missing
        if (!order.email && shopOrder.email) {
          order.email = shopOrder.email;
          await store.set(order.orderId, order);
        }

        // Skip if we should stop tracking
        if (shouldStopTracking(order)) continue;

        // Skip if already delivered
        if (order.currentStatus === 'delivered') continue;

        // Check for no_update_yet escalation
        if (!order.currentStatus || order.currentStatus === 'no_update_yet') {
          // Always set status to no_update_yet if not yet set
          if (!order.currentStatus) {
            order.currentStatus = 'no_update_yet';
            order.lastStatusAt = new Date().toISOString();
            await store.set(order.orderId, order);
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
                await sendEvent(payload);
                await store.recordEvent(order.orderId, { metricName, level: 0, uniqueId });
                pollStats.eventsFired++;
              } catch (err) {
                log.error('Failed to send exception event', { orderId: order.orderId, error: err.message });
              }
              order.currentStatus = 'exception';
              await store.set(order.orderId, order);
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
              await sendEvent(payload);
              await store.recordEvent(order.orderId, { metricName, level, uniqueId });
              pollStats.eventsFired++;
            } catch (err) {
              log.error('Failed to send no_update_yet event', { orderId: order.orderId, error: err.message });
            }
          }
        }
      } catch (err) {
        pollStats.errors++;
        log.error('Error processing order in poll', {
          orderId: shopOrder.orderId,
          error: err.message,
        });
      }
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
