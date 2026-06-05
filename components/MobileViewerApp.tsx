import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { type LucideIcon, Boxes, History, LogIn, LogOut, RefreshCw, Receipt, Smartphone, Wallet, AlertTriangle, LayoutDashboard } from 'lucide-react';
import {
  getViewerAuth,
  getViewerDefaultShopId,
  isViewerFirebaseConfigured,
  getViewerFirestore,
} from '../lib/firebase/viewerFirebase';
import { formatLowStockAlertThreshold, isLowStockItem } from '../lib/inventoryPricing';
import { Button } from './ui/Button';
import { InlineAlert } from './ui/InlineAlert';
import {
  cx,
  DashboardMetricCard,
  DashboardNavButton,
  DashboardSectionHeader,
  DashboardSurface,
} from './ui/DashboardPrimitives';
import { COMPANY_DISPLAY_NAME } from '../lib/company';

type ViewerTab = 'overview' | 'inventory' | 'history' | 'expenses';

type ViewerSummary = {
  totalItems: number;
  totalInventoryValue: number;
  lowStockCount: number;
  recentActivityCount: number;
  expenseTotalMonth: number;
  lastUpdated: string;
};

type ViewerInventoryItem = {
  id: string;
  name: string;
  brand?: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  minStockLevel: number;
};

type ViewerTransaction = {
  id: string;
  itemName: string;
  type: string;
  quantityChange: number;
  totalValue: number;
  timestamp: string;
  recipient?: string | null;
};

type ViewerExpense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  recordedBy?: string | null;
};

const SIGNED_OUT_KEY = 'motorworld_mobile_viewer_signed_out';
const SIGNED_OUT_KEY_LEGACY = 'efcp_mobile_viewer_signed_out';

function isViewerSignedOutFlag(): boolean {
  try {
    if (localStorage.getItem(SIGNED_OUT_KEY) === '1') return true;
    if (localStorage.getItem(SIGNED_OUT_KEY_LEGACY) === '1') {
      localStorage.setItem(SIGNED_OUT_KEY, '1');
      localStorage.removeItem(SIGNED_OUT_KEY_LEGACY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

const viewerTabs: Array<{
  id: ViewerTab;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { id: 'overview', label: 'Overview', description: 'Live summary and quick highlights.', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', description: 'Read-only product quantities and values.', icon: Boxes },
  { id: 'history', label: 'History', description: 'Recent transactions from primary Firestore data.', icon: History },
  { id: 'expenses', label: 'Expenses', description: 'Latest expense entries and totals.', icon: Receipt },
];

const formatPeso = (value: number) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MobileViewerApp: React.FC = () => {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shopId, setShopId] = useState(getViewerDefaultShopId());
  const [tab, setTab] = useState<ViewerTab>('overview');
  const [summary, setSummary] = useState<ViewerSummary | null>(null);
  const [inventory, setInventory] = useState<ViewerInventoryItem[]>([]);
  const [history, setHistory] = useState<ViewerTransaction[]>([]);
  const [expenses, setExpenses] = useState<ViewerExpense[]>([]);
  const [autoSignInEnabled, setAutoSignInEnabled] = useState(() => !isViewerSignedOutFlag());

  const firebaseConfigured = isViewerFirebaseConfigured();
  const auth = getViewerAuth();
  const firestore = getViewerFirestore();
  const isStandalone = useMemo(() => {
    if (typeof window === 'undefined') return false;

    const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    const mediaStandalone =
      typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;

    return iosStandalone || mediaStandalone;
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [auth]);

  useEffect(() => {
    if (!auth || !firebaseConfigured || !autoSignInEnabled || auth.currentUser) return;

    signInAnonymously(auth).catch((err) => {
      setError(err instanceof Error ? err.message : 'Anonymous sign-in failed.');
    });
  }, [auth, firebaseConfigured, autoSignInEnabled]);

  const refreshData = async () => {
    if (!authUser) {
      setError('Sign in anonymously to load the mobile viewer.');
      return;
    }
    if (!firestore) {
      setError('Firestore is not configured.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [summarySnap, inventorySnap, historySnap, expensesSnap] = await Promise.all([
        getDoc(doc(firestore, `shops/${shopId}/viewer/summary`)),
        getDoc(doc(firestore, `shops/${shopId}/viewer/inventory`)),
        getDoc(doc(firestore, `shops/${shopId}/viewer/transactions`)),
        getDoc(doc(firestore, `shops/${shopId}/viewer/expenses`)),
      ]);
      const summaryData = (summarySnap.data() || null) as ViewerSummary | null;
      const nextInventory = [...(((inventorySnap.data() || {}).items as ViewerInventoryItem[] | undefined) ?? [])].sort(
        (a, b) => a.name.localeCompare(b.name)
      );
      const nextHistory = [...(((historySnap.data() || {}).transactions as ViewerTransaction[] | undefined) ?? [])].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const nextExpenses = [...(((expensesSnap.data() || {}).expenses as ViewerExpense[] | undefined) ?? [])].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      setInventory(nextInventory);
      setHistory(nextHistory.slice(0, 50));
      setExpenses(nextExpenses.slice(0, 50));
      setSummary(
        summaryData || {
          totalItems: nextInventory.length,
          totalInventoryValue: nextInventory.reduce(
            (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
            0
          ),
          lowStockCount: nextInventory.filter(
            (item) => isLowStockItem(item)
          ).length,
          recentActivityCount: nextHistory.slice(0, 20).length,
          expenseTotalMonth: nextExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
          lastUpdated: new Date().toISOString(),
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load viewer data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    refreshData();
  }, [authUser]);

  const handleAnonymousSignIn = async () => {
    if (!auth) return;

    setError(null);
    setAutoSignInEnabled(true);
    localStorage.removeItem(SIGNED_OUT_KEY);
    localStorage.removeItem(SIGNED_OUT_KEY_LEGACY);

    try {
      await signInAnonymously(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anonymous sign-in failed.');
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;

    setError(null);
    setAutoSignInEnabled(false);
    localStorage.setItem(SIGNED_OUT_KEY, '1');
    localStorage.removeItem(SIGNED_OUT_KEY_LEGACY);

    try {
      await signOut(auth);
      setSummary(null);
      setInventory([]);
      setHistory([]);
      setExpenses([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  };

  const lowStockItems = useMemo(
    () => inventory.filter((item) => isLowStockItem(item)),
    [inventory]
  );

  const activeTab = viewerTabs.find((item) => item.id === tab) ?? viewerTabs[0];

  if (!firebaseConfigured) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.38),_rgba(248,250,252,1)_38%,_rgba(224,231,255,0.3)_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-2xl">
          <DashboardSurface className="p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-[0_22px_35px_-24px_rgba(129,140,248,0.95)]">
                <Smartphone className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">{COMPANY_DISPLAY_NAME}</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Viewer not configured</h1>
                <p className="mt-2 text-sm text-slate-600">Firebase viewer is not configured yet.</p>
              </div>
            </div>
            <InlineAlert
              variant="info"
              className="mt-5"
              message="Add the Firebase app env values and admin service-account env values, then reopen this standalone viewer page."
            />
          </DashboardSurface>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.38),_rgba(248,250,252,1)_38%,_rgba(224,231,255,0.3)_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-4 px-3 py-3 sm:gap-6 sm:px-4 lg:px-6">
        <aside className="hidden w-[280px] shrink-0 lg:flex">
          <DashboardSurface tone="dark" className="sticky top-3 flex h-[calc(100vh-1.5rem)] w-full flex-col p-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 shadow-[0_22px_35px_-24px_rgba(129,140,248,0.9)]">
                <Smartphone className="h-7 w-7 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">Read-only viewer</p>
                <h1 className="truncate text-sm font-semibold leading-snug text-white">{COMPANY_DISPLAY_NAME}</h1>
                <p className="text-xs text-slate-200">Phone-ready dashboard</p>
              </div>
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-600 bg-slate-800/80 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">Shop</p>
              <p className="mt-2 text-sm font-medium text-white">{shopId || 'Auto-detect'}</p>
              <p className="mt-1 text-xs text-slate-200">{authUser ? 'Anonymous Firebase access' : 'Waiting for sign-in'}</p>
            </div>

            <div className="mt-6 flex-1 space-y-2">
              {viewerTabs.map((item) => (
                <DashboardNavButton
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={tab === item.id}
                  onClick={() => setTab(item.id)}
                  suffix={<span className={cx('text-xs font-medium', tab === item.id ? 'text-white/80' : 'text-slate-500')}>{item.id === 'inventory' ? inventory.length : item.id === 'history' ? history.length : item.id === 'expenses' ? expenses.length : 'Live'}</span>}
                />
              ))}
            </div>

            <div className="space-y-2 border-t border-white/10 pt-5">
              <Button
                variant="ghost"
                className="w-full justify-start bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white"
                onClick={() => {
                  window.location.href = './';
                }}
              >
                Back to {COMPANY_DISPLAY_NAME}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white"
                onClick={refreshData}
                disabled={loading || !authUser}
              >
                <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
                Refresh data
              </Button>
              {authUser ? (
                <Button
                  variant="ghost"
                  className="w-full justify-start bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              ) : (
                <Button className="w-full justify-start" onClick={handleAnonymousSignIn} disabled={authLoading}>
                  <LogIn className="h-4 w-4" />
                  Sign in anonymously
                </Button>
              )}
            </div>
          </DashboardSurface>
        </aside>

        <main className="min-w-0 flex-1 pb-24 lg:pb-0">
          <div className="mb-4 lg:hidden">
            <DashboardSurface tone="dark" className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
                    <Smartphone className="h-3.5 w-3.5" />
                    {COMPANY_DISPLAY_NAME}
                  </div>
                  <h1 className="mt-3 text-xl font-semibold text-white">Phone Dashboard</h1>
                  <p className="mt-1 text-sm text-slate-400">Shop: {shopId || 'main'}</p>
                </div>
                <Button
                  variant="ghost"
                  className="shrink-0 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1] hover:text-white"
                  onClick={() => {
                    window.location.href = './';
                  }}
                >
                  Back
                </Button>
              </div>
            </DashboardSurface>
          </div>

          {error && <InlineAlert message={error} className="mb-4" />}
          {!isStandalone && (
            <InlineAlert
              variant="info"
              className="mb-4"
              message="Install this viewer from your phone browser menu to open it like a regular app."
            />
          )}

          {!authUser ? (
            <DashboardSurface className="p-6 sm:p-8">
              <DashboardSectionHeader
                eyebrow="Anonymous Access"
                title="Sign in to load the live Firestore viewer"
                description="This viewer uses anonymous Firebase Auth and reads directly from the primary Firebase data."
              />
              <p className="mt-5 text-sm text-slate-500">
                Tap <span className="font-medium text-slate-900">Sign in anonymously</span> to load the latest read-only inventory, transaction, and expense data.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={handleAnonymousSignIn} disabled={authLoading}>
                  <LogIn className="h-4 w-4" />
                  Sign in anonymously
                </Button>
                <Button variant="secondary" onClick={refreshData} disabled>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </DashboardSurface>
          ) : (
            <>
              <DashboardSurface className="mb-6 p-5 sm:p-6">
                <DashboardSectionHeader
                  eyebrow="Viewer App"
                  title={activeTab.label}
                  description={activeTab.description}
                  action={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button variant="secondary" onClick={refreshData} disabled={loading}>
                        <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
                        Refresh
                      </Button>
                      <Button variant="secondary" onClick={handleSignOut}>
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </Button>
                    </div>
                  }
                />
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                  {viewerTabs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={cx(
                        'shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors',
                        tab === item.id
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600'
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </DashboardSurface>

              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <DashboardMetricCard title="Items in stock" value={summary?.totalItems ?? 0} icon={Boxes} accent="sky" />
                    <DashboardMetricCard
                      title="Inventory value"
                      value={formatPeso(summary?.totalInventoryValue ?? 0)}
                      icon={Wallet}
                      accent="emerald"
                    />
                    <DashboardMetricCard
                      title="Recent activity"
                      value={summary?.recentActivityCount ?? 0}
                      icon={History}
                      accent="violet"
                    />
                    <DashboardMetricCard
                      title="Low stock"
                      value={summary?.lowStockCount ?? 0}
                      icon={AlertTriangle}
                      accent="amber"
                      trend={(summary?.lowStockCount ?? 0) > 0 ? 'Needs attention' : 'Healthy level'}
                      trendUp={(summary?.lowStockCount ?? 0) === 0}
                    />
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
                    <DashboardSurface className="p-5 sm:p-6">
                      <DashboardSectionHeader
                        eyebrow="Expenses"
                        title="Monthly expense total"
                        description={`Snapshot updated ${
                          summary?.lastUpdated ? new Date(summary.lastUpdated).toLocaleString() : 'not yet'
                        }`}
                      />
                      <div className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
                        {formatPeso(summary?.expenseTotalMonth ?? 0)}
                      </div>
                      <div className="mt-6 space-y-3">
                        {history.slice(0, 4).map((tx) => (
                          <div
                            key={tx.id}
                            className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/90 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{tx.itemName}</p>
                              <p className="text-xs uppercase tracking-wide text-slate-500">{tx.type}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-semibold text-slate-900">
                                {tx.quantityChange > 0 ? '+' : ''}
                                {tx.quantityChange}
                              </p>
                              <p className="text-xs text-slate-400">{formatPeso(tx.totalValue)}</p>
                            </div>
                          </div>
                        ))}
                        {history.length === 0 && <p className="text-sm text-slate-400">No recent transactions published.</p>}
                      </div>
                    </DashboardSurface>

                    <DashboardSurface className="p-5 sm:p-6">
                      <DashboardSectionHeader
                        eyebrow="Stock"
                        title="Low stock watchlist"
                        description="Quick scan of items near or below their threshold."
                      />
                      <div className="mt-5 space-y-3">
                        {lowStockItems.slice(0, 6).map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/90 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{item.name}</p>
                              <p className="text-xs text-slate-500">{item.category}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-semibold text-amber-700">
                                {item.quantity} {item.unit}
                              </p>
                              <p className="text-xs text-slate-400">Alert ≤ {formatLowStockAlertThreshold(item.minStockLevel)}</p>
                            </div>
                          </div>
                        ))}
                        {lowStockItems.length === 0 && <p className="text-sm text-slate-400">No low-stock items right now.</p>}
                      </div>
                    </DashboardSurface>
                  </div>
                </div>
              )}

              {tab === 'inventory' && (
                <DashboardSurface className="overflow-hidden">
                  <div className="border-b border-slate-200/80 px-5 py-5 sm:px-6">
                    <DashboardSectionHeader
                      eyebrow="Inventory"
                      title="Live stock data"
                      description="Read-only primary Firestore data for mobile viewing."
                    />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {inventory.map((item) => (
                      <div key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500">{[item.brand, item.category].filter(Boolean).join(' · ')}</p>
                        </div>
                        <div className="flex gap-5 text-sm">
                          <div>
                            <p className="text-slate-400">Qty</p>
                            <p className="font-semibold text-slate-900">
                              {item.quantity} {item.unit}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-400">Price</p>
                            <p className="font-semibold text-slate-900">{formatPeso(item.unitPrice)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {inventory.length === 0 && <p className="px-5 py-6 text-sm text-slate-400 sm:px-6">No inventory data found.</p>}
                  </div>
                </DashboardSurface>
              )}

              {tab === 'history' && (
                <DashboardSurface className="overflow-hidden">
                  <div className="border-b border-slate-200/80 px-5 py-5 sm:px-6">
                    <DashboardSectionHeader
                      eyebrow="History"
                      title="Recent transactions"
                      description="Latest movement records from the primary Firebase data."
                    />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {history.map((tx) => (
                      <div key={tx.id} className="px-5 py-4 sm:px-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{tx.itemName}</p>
                            <p className="text-xs uppercase tracking-wide text-slate-500">{tx.type}</p>
                          </div>
                          <div className="shrink-0 text-right text-sm">
                            <p className="font-semibold text-slate-900">
                              {tx.quantityChange > 0 ? '+' : ''}
                              {tx.quantityChange}
                            </p>
                            <p className="text-slate-500">{formatPeso(tx.totalValue)}</p>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {new Date(tx.timestamp).toLocaleString()}
                          {tx.recipient ? ` · ${tx.recipient}` : ''}
                        </p>
                      </div>
                    ))}
                    {history.length === 0 && <p className="px-5 py-6 text-sm text-slate-400 sm:px-6">No recent transactions found.</p>}
                  </div>
                </DashboardSurface>
              )}

              {tab === 'expenses' && (
                <DashboardSurface className="overflow-hidden">
                  <div className="border-b border-slate-200/80 px-5 py-5 sm:px-6">
                    <DashboardSectionHeader
                      eyebrow="Expenses"
                      title="Recent expense records"
                      description="Outgoing costs loaded directly from Firestore."
                    />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {expenses.map((expense) => (
                      <div key={expense.id} className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{expense.title}</p>
                          <p className="text-xs text-slate-500">
                            {expense.category} · {new Date(expense.date).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-slate-900">{formatPeso(expense.amount)}</p>
                          <p className="text-xs text-slate-500">{expense.recordedBy || 'System'}</p>
                        </div>
                      </div>
                    ))}
                    {expenses.length === 0 && <p className="px-5 py-6 text-sm text-slate-400 sm:px-6">No expense data found.</p>}
                  </div>
                </DashboardSurface>
              )}
            </>
          )}
        </main>
      </div>

      {authUser && (
        <div className="fixed inset-x-3 bottom-3 lg:hidden">
          <DashboardSurface tone="dark" className="p-2">
            <div className="grid grid-cols-4 gap-2">
              {viewerTabs.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cx(
                      'flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-xs font-medium transition-colors',
                      tab === item.id
                        ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white'
                        : 'bg-white/[0.04] text-slate-300'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </DashboardSurface>
        </div>
      )}
    </div>
  );
};
