import { chinaOrigin, international, usArrival, usDomestic, delivery } from './keywords/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('normalizer');

function containsAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function hoursSince(dateStr) {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function getLatestCheckpoint(checkpoints) {
  if (!checkpoints || checkpoints.length === 0) return null;
  return checkpoints[0];
}

function classifyByCheckpoint(description) {
  if (!description) return null;

  // Delivery (check first — most specific)
  if (containsAny(description, delivery.delivered)) return 'delivered';
  if (containsAny(description, delivery.out_for_delivery)) return 'out_for_delivery';
  if (containsAny(description, delivery.exception)) return 'exception';

  // US domestic transit
  if (containsAny(description, usDomestic.terms)) {
    // Confirm it's actually US by checking for state codes or US carriers
    const hasUsIndicator =
      containsAny(description, usArrival.carriers_first_mention) ||
      usDomestic.states.some((st) => {
        const regex = new RegExp(`\\b${st}\\b`);
        return regex.test(description.toUpperCase());
      });
    if (hasUsIndicator) return 'in_transit_us';
  }

  // US arrival / customs
  if (containsAny(description, usArrival.terms_en) || containsAny(description, usArrival.terms_cn)) {
    return 'arrived_us_hub';
  }
  if (usArrival.hubs.some((hub) => description.toUpperCase().includes(hub))) {
    return 'arrived_us_hub';
  }

  // International departure
  if (containsAny(description, international.departure_en) || containsAny(description, international.departure_cn)) {
    return 'departed_origin';
  }
  if (containsAny(description, international.customs_generic)) {
    return 'arrived_us_hub';
  }

  // China origin
  if (containsAny(description, chinaOrigin.cities)) return 'in_transit_china';
  if (containsAny(description, chinaOrigin.actions_en) || containsAny(description, chinaOrigin.actions_cn)) {
    return 'in_transit_china';
  }

  return null;
}

/**
 * Normalize raw tracking data into an internal mapped_status.
 *
 * @param {object} params
 * @param {string} params.status - ParcelPanel status (e.g. "IN_TRANSIT", "DELIVERED")
 * @param {string} [params.substatus] - ParcelPanel substatus
 * @param {Array}  [params.checkpoints] - Array of checkpoint objects (newest first)
 * @param {string} [params.fulfillmentDate] - ISO date of fulfillment creation
 * @returns {{ mappedStatus: string, description: string }}
 */
export function normalizeStatus({ status, substatus, checkpoints = [], fulfillmentDate }) {
  const upperStatus = (status || '').toUpperCase();
  const checkpoint = getLatestCheckpoint(checkpoints);
  const checkpointDesc = checkpoint?.description || checkpoint?.message || '';
  const hours = hoursSince(fulfillmentDate);

  // Step 1: No update yet (MOST CRITICAL)
  if (
    upperStatus === 'PENDING' ||
    upperStatus === 'INFO_RECEIVED' ||
    upperStatus === 'NOTFOUND' ||
    (checkpoints.length === 0 && fulfillmentDate && hours > 1)
  ) {
    log.debug('Classified as no_update_yet', { status, hours, checkpointsCount: checkpoints.length });
    return {
      mappedStatus: 'no_update_yet',
      description: `No tracking update. ${Math.floor(hours)} hours since fulfillment.`,
    };
  }

  // Step 2: Direct status mapping
  if (upperStatus === 'DELIVERED') {
    return { mappedStatus: 'delivered', description: checkpointDesc || 'Package delivered' };
  }
  if (upperStatus === 'OUT_FOR_DELIVERY' || upperStatus === 'OUTFORDELIVERY') {
    return { mappedStatus: 'out_for_delivery', description: checkpointDesc || 'Out for delivery' };
  }
  if (['EXCEPTION', 'FAILED_ATTEMPT', 'EXPIRED', 'RETURNED'].includes(upperStatus)) {
    return { mappedStatus: 'exception', description: checkpointDesc || `Exception: ${status}` };
  }

  // Step 3: Analyze checkpoints for IN_TRANSIT and similar
  if (checkpointDesc) {
    const classified = classifyByCheckpoint(checkpointDesc);
    if (classified) {
      log.debug('Classified by checkpoint keywords', { classified, checkpointDesc });
      return { mappedStatus: classified, description: checkpointDesc };
    }

    // Also scan older checkpoints for context
    for (const cp of checkpoints.slice(1, 5)) {
      const desc = cp?.description || cp?.message || '';
      const olderClassified = classifyByCheckpoint(desc);
      if (olderClassified) {
        log.debug('Classified by older checkpoint', { olderClassified, desc });
        return { mappedStatus: olderClassified, description: checkpointDesc };
      }
    }
  }

  // Step 4: Fallback by time
  if (hours <= 72) {
    return { mappedStatus: 'in_transit_china', description: checkpointDesc || 'In transit from origin' };
  }
  if (hours <= 168) {
    return { mappedStatus: 'departed_origin', description: checkpointDesc || 'Estimated: in international transit' };
  }
  if (hours <= 336) {
    return { mappedStatus: 'arrived_us_hub', description: checkpointDesc || 'Estimated: arrived at destination country' };
  }
  return { mappedStatus: 'in_transit_us', description: checkpointDesc || 'Estimated: in domestic transit' };
}
