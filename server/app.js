import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth.js';
import { shopScopeMiddleware } from './middleware/shopScope.js';
import authRoutes from './routes/auth.js';
import systemRoutes from './routes/system.js';
import usersRoutes from './routes/users.js';
import activityRoutes from './routes/activity.js';
import notificationsRoutes from './routes/notifications.js';
import transactionsRoutes from './routes/transactions.js';
import itemsRoutes from './routes/items.js';
import soaRoutes from './routes/soa.js';
import loansRoutes from './routes/loans.js';
import personsRoutes from './routes/persons.js';
import vehiclesRoutes from './routes/vehicles.js';
import expensesRoutes from './routes/expenses.js';
import suppliersRoutes from './routes/suppliers.js';
import purchasesRoutes from './routes/purchases.js';
import paymentJournalRoutes from './routes/paymentJournal.js';
import documentArchivesRoutes from './routes/documentArchives.js';
import publicCatalogRoutes from './routes/publicCatalog.js';
import bookingsRoutes from './routes/bookings.js';
import payrollRoutes from './routes/payroll.js';
import sr1ImportRoutes from './routes/sr1Import.js';
import { warmDatabaseConnection } from './db/collectionsBackend.js';
import { ensureStoreInitialized } from './db/store.js';
import { isEmergencyDbBypass } from './lib/emergencyAuth.js';
import { getWebOriginsRaw } from './lib/secrets.js';

dotenv.config({ quiet: true });

function buildCorsOptions() {
  const raw = getWebOriginsRaw();
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!raw) {
    if (isProd) {
      return { origin: false, credentials: true };
    }
    return { origin: true, credentials: true };
  }
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      return cb(null, list.includes(origin));
    },
    credentials: true,
  };
}

const app = express();

if (String(process.env.TRUST_PROXY || '') === '1' || String(process.env.TRUST_PROXY || '').toLowerCase() === 'true') {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors(buildCorsOptions()));
app.use(express.json());

/** Fast path for probes — no store init. */
app.get('/api/health', (req, res) => res.json({ ok: true }));

/** Neon / Postgres keep-warm (Vercel Cron). No full store seed — only connect + SELECT 1. */
async function handleDbWarm(req, res) {
  try {
    await warmDatabaseConnection();
    return res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
}
app.get('/api/system/warm', handleDbWarm);
/** Alias: common typo / old cron path — must not fall through to store init (would cold-timeout). */
app.get('/api/system/warn', handleDbWarm);

app.use(async (req, res, next) => {
  if (isEmergencyDbBypass()) {
    return next();
  }
  try {
    await ensureStoreInitialized();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/public', publicCatalogRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/bookings', authMiddleware, shopScopeMiddleware, bookingsRoutes);
app.use('/api/system', authMiddleware, systemRoutes);
app.use('/api/users', authMiddleware, shopScopeMiddleware, usersRoutes);
app.use('/api/activity', authMiddleware, shopScopeMiddleware, activityRoutes);
app.use('/api/notifications', authMiddleware, shopScopeMiddleware, notificationsRoutes);
app.use('/api/transactions', authMiddleware, shopScopeMiddleware, transactionsRoutes);
app.use('/api/items', authMiddleware, shopScopeMiddleware, itemsRoutes);
app.use('/api/soa', authMiddleware, shopScopeMiddleware, soaRoutes);
app.use('/api/loans', authMiddleware, shopScopeMiddleware, loansRoutes);
app.use('/api/persons', authMiddleware, shopScopeMiddleware, personsRoutes);
app.use('/api/vehicles', authMiddleware, shopScopeMiddleware, vehiclesRoutes);
app.use('/api/expenses', authMiddleware, shopScopeMiddleware, expensesRoutes);
app.use('/api/payroll', authMiddleware, shopScopeMiddleware, payrollRoutes);
app.use('/api/suppliers', authMiddleware, shopScopeMiddleware, suppliersRoutes);
app.use('/api/purchases', authMiddleware, shopScopeMiddleware, purchasesRoutes);
app.use('/api/payment-journal', authMiddleware, shopScopeMiddleware, paymentJournalRoutes);
app.use('/api/document-archives', authMiddleware, shopScopeMiddleware, documentArchivesRoutes);
app.use('/api/imports/sr1', authMiddleware, shopScopeMiddleware, sr1ImportRoutes);

// Global error handler so 500 responses return JSON with error message
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const msg = (err && typeof err === 'object' && 'message' in err) ? String(err.message) : String(err || 'Unknown error');
  res.status(500).json({ error: msg });
});

export default app;
