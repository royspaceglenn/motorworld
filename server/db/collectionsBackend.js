/**
 * Single-table JSON collections storage: local SQLite (default) or PostgreSQL when DATABASE_URL is set.
 * On Vercel, Postgres uses @neondatabase/serverless (HTTP) instead of TCP `pg` — avoids long hangs when Neon wakes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isEmergencyDbBypass } from '../lib/emergencyAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const dataDir = path.join(serverRoot, 'data');
function defaultSqlitePath() {
  const motorworld = path.join(dataDir, 'motorworld.sqlite');
  const legacy = path.join(dataDir, 'efcp.sqlite');
  if (fs.existsSync(motorworld)) return motorworld;
  if (fs.existsSync(legacy)) return legacy;
  return motorworld;
}
const dbPath = process.env.SQLITE_DB_PATH || defaultSqlitePath();

const LEGACY_IMPORTS = {
  users: 'users.json',
  items: 'items.json',
  transactions: 'transactions.json',
  activity_logs: 'activity_logs.json',
  notifications: 'notifications.json',
};

let mode = 'sqlite';
/** @type {import('node:sqlite').DatabaseSync | null} */
let sqliteDb = null;
/** @type {import('pg').Pool | null} */
let pgPool = null;
/** @type {((strings: TemplateStringsArray, ...params: unknown[]) => Promise<unknown[]>) | null} */
let neonSql = null;

function useNeonServerlessOnVercel() {
  return String(process.env.VERCEL || '').trim() === '1' && Boolean(process.env.DATABASE_URL?.trim());
}

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function initSqlite() {
  if (String(process.env.VERCEL || '').trim() === '1') {
    throw new Error(
      '[motor-world] SQLite is not supported on Vercel (read-only deployment disk). Set DATABASE_URL to PostgreSQL (e.g. Neon or Supabase).'
    );
  }
  ensureDataDir();
  const { DatabaseSync } = await import('node:sqlite');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL');
  sqliteDb.exec('PRAGMA foreign_keys = ON');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      name TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

async function initNeonPostgres() {
  const { neon } = await import('@neondatabase/serverless');
  const connectionString = process.env.DATABASE_URL.trim();
  neonSql = neon(connectionString);
  await neonSql`
    CREATE TABLE IF NOT EXISTS collections (
      name TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `;
}

async function initPostgres() {
  const { Pool } = await import('pg');
  const connectionString = process.env.DATABASE_URL.trim();
  const onVercel = String(process.env.VERCEL || '').trim() === '1';
  pgPool = new Pool({
    connectionString,
    max: onVercel ? 2 : 10,
    idleTimeoutMillis: onVercel ? 20_000 : 30_000,
    connectionTimeoutMillis: onVercel ? 20_000 : 0,
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS collections (
      name TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
}

/**
 * @returns {'postgres'|'sqlite'}
 */
export function getCollectionsBackendMode() {
  return mode === 'postgres' ? 'postgres' : 'sqlite';
}

export async function initCollectionsBackend() {
  if (isEmergencyDbBypass()) return;
  if (sqliteDb || pgPool || neonSql) return;

  if (process.env.DATABASE_URL?.trim()) {
    mode = 'postgres';
    if (useNeonServerlessOnVercel()) {
      await initNeonPostgres();
    } else {
      await initPostgres();
    }
    return;
  }

  mode = 'sqlite';
  await initSqlite();
}

/** Light DB touch for cron / warmup (connect + SELECT 1). Does not seed collections. */
export async function warmDatabaseConnection() {
  if (isEmergencyDbBypass()) return;
  await initCollectionsBackend();
  if (neonSql) {
    await neonSql`SELECT 1`;
    return;
  }
  if (mode === 'postgres' && pgPool) {
    await pgPool.query('SELECT 1');
  }
}

export async function closeCollectionsBackend() {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  neonSql = null;
  sqliteDb = null;
  mode = 'sqlite';
}

async function getCollectionRow(name) {
  if (mode === 'postgres') {
    if (neonSql) {
      const rows = await neonSql`SELECT payload FROM collections WHERE name = ${name}`;
      if (!rows[0]) return null;
      const p = rows[0].payload;
      return { payload: typeof p === 'string' ? p : JSON.stringify(p) };
    }
    const { rows } = await pgPool.query('SELECT payload FROM collections WHERE name = $1', [name]);
    if (!rows[0]) return null;
    const p = rows[0].payload;
    return { payload: typeof p === 'string' ? p : JSON.stringify(p) };
  }
  return sqliteDb.prepare('SELECT payload FROM collections WHERE name = ?').get(name);
}

async function upsertCollection(name, payload) {
  const json = JSON.stringify(payload);
  const ts = new Date().toISOString();
  if (mode === 'postgres') {
    if (neonSql) {
      const body = JSON.parse(json);
      await neonSql`
        INSERT INTO collections (name, payload, updated_at)
        VALUES (${name}, ${body}, ${ts})
        ON CONFLICT (name) DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      `;
      return;
    }
    await pgPool.query(
      `INSERT INTO collections (name, payload, updated_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (name) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [name, json, ts]
    );
    return;
  }
  sqliteDb
    .prepare(
      `
    INSERT INTO collections (name, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `
    )
    .run(name, json, ts);
}

/** Read JSON payload without creating an empty row (used for shop-prefixed keys + legacy migration). */
export async function readCollectionRaw(name) {
  if (isEmergencyDbBypass()) return null;
  await initCollectionsBackend();
  const row = await getCollectionRow(name);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export async function readCollection(name, fallback = []) {
  if (isEmergencyDbBypass()) {
    return structuredClone(fallback);
  }
  await initCollectionsBackend();
  const row = await getCollectionRow(name);
  if (!row) {
    await upsertCollection(name, fallback);
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(row.payload);
  } catch {
    await upsertCollection(name, fallback);
    return structuredClone(fallback);
  }
}

export async function writeCollection(name, value) {
  if (isEmergencyDbBypass()) {
    console.warn('[motor-world] EMERGENCY_BYPASS_DB: write skipped for', name);
    return;
  }
  await initCollectionsBackend();
  await upsertCollection(name, value);
}

export async function seedEmptyCollections(collectionNames) {
  if (isEmergencyDbBypass()) return;
  await initCollectionsBackend();
  await Promise.all(
    collectionNames.map(async (name) => {
      const row = await getCollectionRow(name);
      if (!row) {
        const legacyFile = LEGACY_IMPORTS[name];
        const initialValue = legacyFile ? readJsonSafe(path.join(dataDir, legacyFile), []) : [];
        await upsertCollection(name, initialValue);
      }
    })
  );
}

/**
 * Remove all collection rows whose name starts with `${shopId}::` (multi-store isolation).
 * Does not touch global `users` or legacy unprefixed rows.
 */
export async function deleteCollectionsByShopPrefix(shopId) {
  if (isEmergencyDbBypass()) return 0;
  const prefix = `${String(shopId || '').trim()}::`;
  if (!prefix || prefix === '::') return 0;
  await initCollectionsBackend();
  const like = `${prefix}%`;
  if (mode === 'postgres') {
    if (neonSql) {
      await neonSql`DELETE FROM collections WHERE name LIKE ${like}`;
      return 0;
    }
    const { rowCount } = await pgPool.query('DELETE FROM collections WHERE name LIKE $1', [like]);
    return rowCount ?? 0;
  }
  const info = sqliteDb.prepare('DELETE FROM collections WHERE name LIKE ?').run(like);
  return Number(info.changes || 0);
}
