import crypto from 'crypto';
import fs from 'fs';
import dns from 'dns/promises';
import path from 'path';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { getAllItems, getExpenses, getTransactions } from '../db/store.js';
import { ensureSyncSettingsFile, loadSyncSettings } from './syncSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverRoot, '..');

let appInstance = null;
let syncTimer = null;
let syncIntervalHandle = null;
let syncInFlight = false;
let lastSuccessfulHash = '';

function normalizeSettings() {
  return loadSyncSettings();
}

function getShopId(settings) {
  return settings.firebaseShopId || 'main';
}

function readServiceAccount(settings) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const configuredPath = settings.firebaseServiceAccountJsonPath;
  if (!configuredPath) return null;

  const candidates = [];
  if (path.isAbsolute(configuredPath)) {
    candidates.push(configuredPath);
  } else {
    if (process.env.MOTOR_WORLD_APP_DATA_DIR) {
      candidates.push(path.join(process.env.MOTOR_WORLD_APP_DATA_DIR, configuredPath));
    }
    if (process.env.EFCP_APP_DATA_DIR) {
      candidates.push(path.join(process.env.EFCP_APP_DATA_DIR, configuredPath));
    }
    candidates.push(path.join(projectRoot, configuredPath));
    candidates.push(path.join(serverRoot, configuredPath));
  }

  const absolutePath = candidates.find((p) => fs.existsSync(p));
  if (!absolutePath) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function getFirebaseApp(settings) {
  if (appInstance) return appInstance;
  const serviceAccount = readServiceAccount(settings);
  const projectId = settings.firebaseProjectId || serviceAccount?.project_id;
  if (!serviceAccount || !projectId) return null;

  appInstance = admin.apps[0]
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });

  return appInstance;
}

async function hasInternetConnection() {
  try {
    await dns.lookup('firestore.googleapis.com');
    return true;
  } catch {
    return false;
  }
}

async function buildViewerPayload(settings) {
  const shopId = getShopId(settings);
  const allItems = await getAllItems();
  const allTx = await getTransactions();
  const allExpenses = await getExpenses();
  const items = allItems.map((item) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    category: item.category,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    capitalPrice: item.capitalPrice ?? item.unitPrice,
    minStockLevel: item.minStockLevel,
    lastUpdated: item.lastUpdated,
    stockPurpose: item.stockPurpose === 'for_supply' ? 'for_supply' : 'for_sale',
  }));
  const transactions = allTx.slice(0, 150).map((tx) => ({
    id: tx.id,
    itemId: tx.itemId,
    itemName: tx.itemName,
    type: tx.type,
    quantityChange: tx.quantityChange,
    totalValue: tx.totalValue,
    timestamp: tx.timestamp,
    recipient: tx.recipient ?? null,
  }));
  const expenses = allExpenses.slice(0, 150).map((expense) => ({
    id: expense.id,
    title: expense.title,
    category: expense.category,
    amount: expense.amount,
    date: expense.date,
    recordedBy: expense.recordedBy,
  }));

  const totalInventoryValue = items.reduce(
    (sum, item) => sum + item.quantity * (item.capitalPrice ?? item.unitPrice ?? 0),
    0
  );
  const lowStockCount = items.filter((item) => {
    const min = Number(item.minStockLevel ?? 0);
    if (min < 0) return false;
    return Number(item.quantity ?? 0) <= min;
  }).length;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const expenseTotalMonth = expenses
    .filter((expense) => new Date(expense.date).getTime() >= startOfMonth.getTime())
    .reduce((sum, expense) => sum + expense.amount, 0);
  const updatedAt = new Date().toISOString();

  return {
    shopId,
    updatedAt,
    summary: {
      totalItems: items.length,
      totalInventoryValue,
      lowStockCount,
      recentActivityCount: transactions.slice(0, 20).length,
      expenseTotalMonth,
      lastUpdated: updatedAt,
    },
    inventory: { items, updatedAt },
    transactions: { transactions, updatedAt },
    expenses: { expenses, updatedAt },
  };
}

function buildPayloadHash(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

async function publishViewerMirror(force = false) {
  const settings = normalizeSettings();
  if (!settings.enabled || !settings.useFirebase) return false;
  if (!(await hasInternetConnection())) return false;

  const app = getFirebaseApp(settings);
  if (!app) return false;

  const firestore = admin.firestore(app);
  const payload = await buildViewerPayload(settings);
  const payloadHash = buildPayloadHash(payload);
  if (!force && payloadHash === lastSuccessfulHash) {
    return true;
  }

  const batch = firestore.batch();
  batch.set(firestore.doc('config/viewer'), { shopId: payload.shopId, updatedAt: payload.updatedAt }, { merge: true });
  batch.set(firestore.doc(`shops/${payload.shopId}/viewer/summary`), payload.summary);
  batch.set(firestore.doc(`shops/${payload.shopId}/viewer/inventory`), payload.inventory);
  batch.set(firestore.doc(`shops/${payload.shopId}/viewer/transactions`), payload.transactions);
  batch.set(firestore.doc(`shops/${payload.shopId}/viewer/expenses`), payload.expenses);
  await batch.commit();
  lastSuccessfulHash = payloadHash;
  return true;
}

async function runSync(force = false) {
  if (syncInFlight) return false;
  syncInFlight = true;
  try {
    return await publishViewerMirror(force);
  } catch (error) {
    console.error('Viewer mirror sync failed:', error?.message || error);
    return false;
  } finally {
    syncInFlight = false;
  }
}

export function scheduleViewerSync(delayMs = 500) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void runSync();
  }, delayMs);
}

export function startViewerSyncLoop() {
  ensureSyncSettingsFile();

  const settings = normalizeSettings();
  const intervalSeconds = Number.isFinite(settings.syncIntervalSeconds) && settings.syncIntervalSeconds > 0
    ? settings.syncIntervalSeconds
    : 30;

  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
  }

  scheduleViewerSync(1000);
  syncIntervalHandle = setInterval(() => {
    void runSync();
  }, intervalSeconds * 1000);
}

export function stopViewerSyncLoop() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
  }
}
