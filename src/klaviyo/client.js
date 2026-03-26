import { config } from '../../config.js';
import { withRetry } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('klaviyo');

/**
 * Send an event to Klaviyo Events API v3.
 * @param {object} eventPayload - The full Klaviyo event payload ({ data: { ... } })
 */
export async function sendEvent(eventPayload) {
  const { privateKey, apiRevision, baseUrl } = config.klaviyo;

  if (!privateKey) {
    log.error('Klaviyo private key not configured. Skipping event.');
    return null;
  }

  const url = `${baseUrl}/events`;
  const metricName = eventPayload?.data?.attributes?.metric?.data?.attributes?.name || 'unknown';
  const uniqueId = eventPayload?.data?.attributes?.unique_id || '';

  log.info('Sending Klaviyo event', { metric: metricName, uniqueId });

  const response = await withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Klaviyo-API-Key ${privateKey}`,
        revision: apiRevision,
      },
      body: JSON.stringify(eventPayload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Klaviyo API error: ${res.status} ${body}`);
      err.status = res.status;
      throw err;
    }

    return res;
  }, `klaviyo-event:${metricName}`);

  log.info('Klaviyo event sent successfully', { metric: metricName, uniqueId });
  return response;
}
