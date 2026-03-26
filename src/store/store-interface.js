/**
 * Store interface contract.
 * Any store implementation must provide these methods.
 *
 * OrderState shape:
 * {
 *   orderId: string,
 *   email: string,
 *   trackingNumber: string,
 *   orderNumber: string,
 *   trackingUrl: string,
 *   currentStatus: string,        // mapped_status
 *   lastStatusAt: string,         // ISO timestamp
 *   fulfillmentDate: string,      // ISO timestamp
 *   eventsSent: Array<{ metricName, level, sentAt, uniqueId }>,
 *   createdAt: string,
 *   updatedAt: string,
 * }
 */

export class StoreInterface {
  /** Get an order by orderId. Returns null if not found. */
  async get(orderId) {
    throw new Error('Not implemented');
  }

  /** Create or update an order state. */
  async set(orderId, orderState) {
    throw new Error('Not implemented');
  }

  /** Get all orders with a specific currentStatus. */
  async getByStatus(status) {
    throw new Error('Not implemented');
  }

  /** Get all orders that are NOT delivered and NOT stopped. */
  async getActive() {
    throw new Error('Not implemented');
  }

  /** Record that an event was sent for an order. */
  async recordEvent(orderId, eventRecord) {
    throw new Error('Not implemented');
  }

  /** Persist changes to durable storage. */
  async save() {
    throw new Error('Not implemented');
  }

  /** Get count of all tracked orders. */
  async count() {
    throw new Error('Not implemented');
  }

  /** Get counts grouped by status. */
  async countByStatus() {
    throw new Error('Not implemented');
  }
}
