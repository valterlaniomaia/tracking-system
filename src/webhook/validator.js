import crypto from 'crypto';
import { config } from '../../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('validator');

/**
 * Verify ParcelPanel webhook HMAC-SHA256 signature.
 */
export function verifyParcelPanel(rawBody, signature, secretOverride) {
  const secret = secretOverride || config.parcelpanel.webhookSecret;
  if (!secret) {
    log.warn('ParcelPanel webhook secret not configured, skipping verification');
    return true;
  }
  if (!signature) {
    log.warn('No signature provided in webhook request');
    return false;
  }

  try {
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature);
    const compBuf = Buffer.from(computed);
    if (sigBuf.length !== compBuf.length) return false;
    return crypto.timingSafeEqual(compBuf, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Verify Shopify webhook HMAC-SHA256 signature.
 */
export function verifyShopify(rawBody, hmacHeader) {
  const secret = config.shopify.accessToken;
  if (!secret || !hmacHeader) {
    log.warn('Shopify webhook verification skipped (missing secret or header)');
    return true;
  }

  const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}
