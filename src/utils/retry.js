import { config } from '../../config.js';
import { createLogger } from './logger.js';

const log = createLogger('retry');

export async function withRetry(fn, label = 'operation') {
  const { maxAttempts, baseDelayMs } = config.retry;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const status = err.status || err.statusCode;
      const retryable = !status || status === 429 || status >= 500;

      if (isLast || !retryable) {
        log.error(`${label} failed after ${attempt} attempt(s)`, {
          error: err.message,
          status,
        });
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      log.warn(`${label} attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: err.message,
        status,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
