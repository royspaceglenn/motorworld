import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_SHOP_ID } from './shops.js';

const storage = new AsyncLocalStorage();

export function runWithShop(shopId, fn) {
  return storage.run({ shopId: shopId || DEFAULT_SHOP_ID }, fn);
}

export function getActiveShopId() {
  const s = storage.getStore();
  return s?.shopId || DEFAULT_SHOP_ID;
}
