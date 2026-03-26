import { config } from '../../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rules');

const { noUpdateLevel1Hours, noUpdateLevel2Hours, noUpdateLevel3Hours, noUpdateExceptionHours, stopTrackingAfterDays } =
  config.thresholds;

function hoursSince(dateStr) {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function daysSince(dateStr) {
  return hoursSince(dateStr) / 24;
}

/**
 * Determine escalation level based on hours since fulfillment.
 */
export function getEscalationLevel(hoursSinceShip) {
  if (hoursSinceShip >= noUpdateExceptionHours) return -1; // Should be exception
  if (hoursSinceShip >= noUpdateLevel3Hours) return 3;
  if (hoursSinceShip >= noUpdateLevel2Hours) return 2;
  if (hoursSinceShip >= noUpdateLevel1Hours) return 1;
  return 0; // Too early
}

/**
 * Check if a specific event was already sent for this order.
 */
export function isEventAlreadySent(order, metricName, level = 0) {
  if (!order.eventsSent) return false;
  const uniqueId = `${order.orderId}-${metricName}-${level}`;
  return order.eventsSent.some((e) => e.uniqueId === uniqueId);
}

/**
 * Generate the unique event ID for deduplication.
 */
export function generateUniqueId(orderId, metricName, level = 0) {
  return `${orderId}-${metricName}-${level}`;
}

/**
 * Determine if a no_update_yet event should fire.
 */
export function shouldFireNoUpdateYet(order) {
  const hours = hoursSince(order.fulfillmentDate);
  const level = getEscalationLevel(hours);

  if (level === 0) return { fire: false, level: 0, reason: 'too_early' };
  if (level === -1) return { fire: false, level: 0, reason: 'should_be_exception' };

  const metricName = config.statusToMetric.no_update_yet;
  if (isEventAlreadySent(order, metricName, level)) {
    return { fire: false, level, reason: 'already_sent' };
  }

  return { fire: true, level };
}

/**
 * Determine if a status change event should fire.
 */
export function shouldFireStatusEvent(order, newMappedStatus) {
  // Never fire for no_update_yet here (handled separately)
  if (newMappedStatus === 'no_update_yet') return false;

  // Don't fire if status hasn't changed
  if (order.currentStatus === newMappedStatus) return false;

  // Don't allow regression (e.g., going from in_transit_us back to in_transit_china)
  const currentIdx = config.statusOrder.indexOf(order.currentStatus);
  const newIdx = config.statusOrder.indexOf(newMappedStatus);
  if (currentIdx >= 0 && newIdx >= 0 && newIdx < currentIdx) {
    log.warn('Status regression blocked', {
      orderId: order.orderId,
      from: order.currentStatus,
      to: newMappedStatus,
    });
    return false;
  }

  // Check deduplication
  const metricName = config.statusToMetric[newMappedStatus];
  if (isEventAlreadySent(order, metricName)) return false;

  return true;
}

/**
 * Determine if order should transition to exception state.
 */
export function shouldTransitionToException(order) {
  if (order.currentStatus === 'delivered') return false;
  if (order.currentStatus === 'exception') return false;

  const hours = hoursSince(order.fulfillmentDate);
  return hours >= noUpdateExceptionHours && order.currentStatus === 'no_update_yet';
}

/**
 * Determine if we should stop tracking this order entirely.
 */
export function shouldStopTracking(order) {
  if (order.currentStatus === 'delivered') return true;

  const days = daysSince(order.fulfillmentDate);
  if (days >= stopTrackingAfterDays) {
    log.info('Order exceeded tracking window', { orderId: order.orderId, days: Math.floor(days) });
    return true;
  }

  return false;
}
