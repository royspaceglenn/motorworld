/**
 * Multi-store: all collections except `users` are stored under `${shopId}::${name}`.
 * Legacy unprefixed rows are migrated into `motorworld::` on first read.
 */
import * as base from './collectionsBackend.js';
import { getActiveShopId } from '../lib/shopContext.js';
import { DEFAULT_SHOP_ID } from '../lib/shops.js';

const GLOBAL_COLLECTIONS = new Set(['users']);

function prefixed(shopId, baseName) {
  return `${shopId}::${baseName}`;
}

export async function initCollectionsBackend() {
  return base.initCollectionsBackend();
}

export async function warmDatabaseConnection() {
  return base.warmDatabaseConnection();
}

export async function closeCollectionsBackend() {
  return base.closeCollectionsBackend();
}

export async function getCollectionsBackendMode() {
  return base.getCollectionsBackendMode();
}

export async function seedEmptyCollections(collectionNames) {
  return base.seedEmptyCollections(collectionNames);
}

export async function deleteCollectionsByShopPrefix(shopId) {
  return base.deleteCollectionsByShopPrefix(shopId);
}

export async function readCollection(name, fallback = []) {
  if (GLOBAL_COLLECTIONS.has(name)) {
    return base.readCollection(name, fallback);
  }
  const shop = getActiveShopId();
  const key = prefixed(shop, name);
  const scoped = await base.readCollectionRaw(key);
  if (scoped !== null) {
    return structuredClone(scoped);
  }
  if (shop === DEFAULT_SHOP_ID) {
    const legacy = await base.readCollectionRaw(name);
    if (legacy !== null) {
      await base.writeCollection(key, legacy);
      return structuredClone(legacy);
    }
  }
  await base.writeCollection(key, fallback);
  return structuredClone(fallback);
}

export async function writeCollection(name, value) {
  if (GLOBAL_COLLECTIONS.has(name)) {
    return base.writeCollection(name, value);
  }
  const shop = getActiveShopId();
  return base.writeCollection(prefixed(shop, name), value);
}
