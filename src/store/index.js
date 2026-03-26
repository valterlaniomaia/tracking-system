import { config } from '../../config.js';
import { JsonStore } from './json-store.js';

let storeInstance = null;

export async function getStore() {
  if (storeInstance) return storeInstance;

  switch (config.store.type) {
    case 'json':
    default:
      storeInstance = new JsonStore(config.store.jsonPath);
      await storeInstance.init();
      return storeInstance;
  }
}
