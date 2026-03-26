import { config } from '../../config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[config.server.logLevel] ?? LEVELS.info;

function log(level, module, message, data) {
  if (LEVELS[level] > currentLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(data !== undefined && { data }),
  };

  const output = JSON.stringify(entry);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export function createLogger(module) {
  return {
    error: (msg, data) => log('error', module, msg, data),
    warn: (msg, data) => log('warn', module, msg, data),
    info: (msg, data) => log('info', module, msg, data),
    debug: (msg, data) => log('debug', module, msg, data),
  };
}
