import { config } from '../../config.js';
import { generateUniqueId } from '../rules/business-rules.js';

/**
 * Build a Klaviyo event payload.
 *
 * @param {object} params
 * @param {string} params.email - Customer email
 * @param {string} params.mappedStatus - Internal status (e.g. "in_transit_china")
 * @param {string} params.orderId - Shopify order ID
 * @param {string} [params.orderNumber] - Shopify order number (e.g. "#1042")
 * @param {string} params.trackingNumber - Carrier tracking number
 * @param {string} [params.trackingUrl] - Tracking URL
 * @param {string} [params.rawStatus] - Raw status from source
 * @param {string} [params.description] - Human-readable description
 * @param {number} [params.daysSinceShipped] - Days since fulfillment
 * @param {number} [params.escalationLevel] - For no_update_yet: 1, 2, or 3
 * @returns {object} Klaviyo event payload
 */
export function buildEvent({
  email,
  mappedStatus,
  orderId,
  orderNumber,
  trackingNumber,
  trackingUrl,
  rawStatus,
  description,
  daysSinceShipped,
  escalationLevel = 0,
}) {
  const metricName = config.statusToMetric[mappedStatus];
  if (!metricName) {
    throw new Error(`Unknown mapped_status: ${mappedStatus}`);
  }

  const uniqueId = generateUniqueId(orderId, metricName, escalationLevel);

  return {
    data: {
      type: 'event',
      attributes: {
        profile: {
          data: {
            type: 'profile',
            attributes: { email },
          },
        },
        metric: {
          data: {
            type: 'metric',
            attributes: { name: metricName },
          },
        },
        properties: {
          order_id: orderId,
          order_number: orderNumber || '',
          tracking_number: trackingNumber,
          tracking_url: trackingUrl || '',
          raw_status: rawStatus || '',
          mapped_status: mappedStatus,
          description: description || '',
          days_since_shipped: daysSinceShipped || 0,
          escalation_level: escalationLevel,
        },
        time: new Date().toISOString(),
        unique_id: uniqueId,
      },
    },
  };
}
