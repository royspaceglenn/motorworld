import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useAuth } from './lib/auth/AuthContext';
import {
  activityApi,
  itemsApi,
  personsApi,
  transactionsApi,
  USE_FIRESTORE_ADMIN_DATA,
  vehiclesApi,
} from './lib/api/adminData';
import {
  ACTIVE_SHOP_SESSION_KEY,
  buildOperationsUrlWithShop,
  getStoredActiveShopId,
  readShopIdFromUrl,
  setStoredActiveShopId,
} from './lib/api/client';
import { SHOPS, workspaceBrand } from './lib/shops';
import { getFirebaseFirestore, getFirebaseShopId } from './lib/firebase/app';
import { FIRESTORE_COLLECTIONS } from './lib/firebase/schema';
import { InventoryItem, Transaction, DashboardStats, Person, Vehicle, normalizeStockPurpose } from './types';
import { StatsCard } from './components/StatsCard';
import { InventoryTable } from './components/InventoryTable';
import { HistoryTable } from './components/HistoryTable';
import { AddItemModal } from './components/AddItemModal';
import { InventoryImportModal } from './components/InventoryImportModal';
import { ReleaseModal } from './components/ReleaseModal';
import { IssueModal } from './components/IssueModal';
import { formatLowStockAlertThreshold, isLowStockItem } from './lib/inventoryPricing';
import { dateInputToIsoTimestamp, todayDateInputValue } from './lib/transactionDate';
import { ReturnModal } from './components/ReturnModal';
import { ReturnFromSalesModal } from './components/ReturnFromSalesModal';
import { AddStockModal } from './components/AddStockModal';
import { EditAdditionTransactionModal } from './components/EditAdditionTransactionModal';
import { ItemDetails } from './components/ItemDetails';
import { ActivityLogView } from './components/ActivityLogView';
import { ManageUsersView } from './components/ManageUsersView';
import { ChangePasswordDialog } from './components/ChangePasswordDialog';
import { NotificationsBell } from './components/NotificationsBell';
import { LoanManagementView } from './components/LoanManagementView';
import { AccountsView } from './components/AccountsView';
import { ExpensesView } from './components/ExpensesView';
import { PurchasingView } from './components/PurchasingView';
import { POSView } from './components/POSView';
import { SalesSummaryReportView } from './components/SalesSummaryReportView';
import { BillingStatementView } from './components/BillingStatementView';
import { BillingStatementPrintModal } from './components/BillingStatementPrintModal';
import { DocumentArchivesView } from './components/DocumentArchivesView';
import { OnlineBookingsView } from './components/OnlineBookingsView';
import { EmployeeSalaryView } from './components/EmployeeSalaryView';
import { DocumentPrintPreviewModal } from './components/DocumentPrintPreviewModal';
import { subscribeDocumentPreview } from './lib/documentPreviewBus';
import type { DocumentPreviewDoc } from './lib/documentPreviewBus';
import { Button } from './components/ui/Button';
import { InlineAlert } from './components/ui/InlineAlert';
import {
  cx,
  DashboardNavButton,
  DashboardSectionHeader,
  DashboardSurface,
} from './components/ui/DashboardPrimitives';
import { 
  Package, 
  PhilippinePeso, 
  AlertOctagon, 
  Activity, 
  Plus, 
  History,
  LayoutDashboard,
  ClipboardList,
  Search,
  Truck,
  ShoppingBag,
  Filter,
  XCircle,
  ChevronDown,
  ArrowUpRight,
  Printer,
  Calendar,
  ArrowDownLeft,
  Shield,
  KeyRound,
  ScrollText,
  Users,
  CreditCard,
  UserCircle,
  Receipt,
  RotateCcw,
  FileSpreadsheet,
  FileText,
  Archive,
  LogOut,
  CalendarClock,
  Wallet,
  Upload,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

type AppView =
  | 'dashboard'
  | 'sales_summary'
  | 'billing_statement'
  | 'inventory'
  | 'history'
  | 'item_details'
  | 'activity_log'
  | 'manage_users'
  | 'receivables'
  | 'accounts'
  | 'expenses'
  | 'purchasing'
  | 'pos'
  | 'document_archives'
  | 'online_bookings'
  | 'employee_salary';

const App: React.FC = () => {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'overseer';
  const canEdit = user?.role === 'admin';

  // --- State ---
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [view, setView] = useState<AppView>('dashboard');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [activityFilterUserId, setActivityFilterUserId] = useState<string | null>(null);
  
  // Inventory Filters State
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [isItemDropdownOpen, setIsItemDropdownOpen] = useState(false);

  // History Filters State
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<string>('All');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [isReturnFromSalesModalOpen, setIsReturnFromSalesModalOpen] = useState(false);
  const [billingStatementPrintTx, setBillingStatementPrintTx] = useState<Transaction | null>(null);
  const [printPreviewDocs, setPrintPreviewDocs] = useState<DocumentPreviewDoc[] | null>(null);
  const [initialReleaseIdForReturn, setInitialReleaseIdForReturn] = useState<string | null>(null);

  const [itemToEdit, setItemToEdit] = useState<InventoryItem | undefined>(undefined);
  const [inventoryFeedback, setInventoryFeedback] = useState<{ message: string; variant?: 'success' | 'error' } | null>(null);
  const [itemToRelease, setItemToRelease] = useState<InventoryItem | null>(null);
  const [itemToIssue, setItemToIssue] = useState<InventoryItem | null>(null);
  const [itemToReturn, setItemToReturn] = useState<InventoryItem | null>(null);
  const [itemToAddStock, setItemToAddStock] = useState<InventoryItem | null>(null);
  const [transactionToEditAddition, setTransactionToEditAddition] = useState<Transaction | null>(null);

  // Normalize item from API so quantity/unitPrice are numbers (keeps total inventory value correct)
  const normalizeItem = React.useCallback((i: any) => {
    const q = Number(i.quantity);
    const p = Number(i.unitPrice ?? i.unit_price ?? 0);
    const cap = Number(i.capitalPrice ?? i.capital_price ?? p);
    const m = Number(i.minStockLevel ?? i.min_stock_level ?? 0);
    return {
      ...i,
      quantity: Number.isFinite(q) ? q : 0,
      unitPrice: Number.isFinite(p) ? p : 0,
      capitalPrice: Number.isFinite(cap) ? cap : p,
      minStockLevel: Number.isFinite(m) ? m : 0,
      itemCode: String(i.itemCode ?? i.item_code ?? '').trim(),
      brand: i.brand ?? '',
      unit: i.unit ?? 'pcs',
      stockPurpose: normalizeStockPurpose(i.stockPurpose ?? i.stock_purpose),
      createdAt: i.createdAt ?? i.created_at ?? undefined,
    };
  }, []);

  /** Seed this tab's store from `?shop=` / hash, or default to first allowed shop (each tab has its own sessionStorage). */
  useLayoutEffect(() => {
    if (USE_FIRESTORE_ADMIN_DATA || !user?.shops?.length) return;
    const allowed = user.shops.filter((id) => id === 'motorworld' || id === 'ecfp');
    if (!allowed.length) return;

    const raw = sessionStorage.getItem(ACTIVE_SHOP_SESSION_KEY)?.trim().toLowerCase();
    const hasSession = raw === 'motorworld' || raw === 'ecfp';

    if (hasSession) {
      if (!allowed.includes(raw)) {
        setStoredActiveShopId(allowed[0]!);
        window.location.reload();
      }
      return;
    }

    const urlShop = readShopIdFromUrl();
    const pick = urlShop && allowed.includes(urlShop) ? urlShop : allowed[0]!;
    setStoredActiveShopId(pick);
  }, [user?.id, user?.shops]);

  const handleShopChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setStoredActiveShopId(e.target.value);
    window.location.reload();
  }, []);

  const openOtherStoreInNewTab = useCallback(
    (shopId: string) => {
      if (!user?.shops?.includes(shopId)) return;
      const url = buildOperationsUrlWithShop(shopId);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    },
    [user?.shops]
  );
  const fetchItemsAndTransactions = React.useCallback(() => {
    if (!user) return;
    itemsApi.list()
      .then((res) => {
        const normalized = (res.items || []).map((i: any) => normalizeItem(i));
        setItems(normalized);
      })
      .catch(() => {});
    transactionsApi.list()
      .then((res) => {
        if (res.transactions && Array.isArray(res.transactions)) setTransactions(res.transactions);
      })
      .catch(() => {});
    personsApi.list()
      .then((res) => setPersons(res.persons ?? []))
      .catch(() => {});
    vehiclesApi.list()
      .then((res) => setVehicles(res.vehicles ?? []))
      .catch(() => {});
  }, [user?.id, normalizeItem]);

  useEffect(() => {
    if (!user) return;

    if (USE_FIRESTORE_ADMIN_DATA) {
      const db = getFirebaseFirestore();
      if (!db) return;
      const shopId = getFirebaseShopId();
      const unsubs = [
        onSnapshot(
          query(collection(db, FIRESTORE_COLLECTIONS.shops, shopId, FIRESTORE_COLLECTIONS.items), orderBy('name')),
          (snap) => {
            const normalized = mapDocs(snap).map((i: any) => normalizeItem(i));
            setItems(normalized);
          }
        ),
        onSnapshot(
          query(
            collection(db, FIRESTORE_COLLECTIONS.shops, shopId, FIRESTORE_COLLECTIONS.transactions),
            orderBy('timestamp', 'desc')
          ),
          (snap) => {
            setTransactions(mapDocs(snap) as Transaction[]);
          }
        ),
        onSnapshot(
          query(
            collection(db, FIRESTORE_COLLECTIONS.shops, shopId, FIRESTORE_COLLECTIONS.persons),
            orderBy('fullName')
          ),
          (snap) => {
            setPersons(mapDocs(snap) as Person[]);
          }
        ),
        onSnapshot(
          query(
            collection(db, FIRESTORE_COLLECTIONS.shops, shopId, FIRESTORE_COLLECTIONS.vehicles),
            orderBy('plateNumber')
          ),
          (snap) => {
            setVehicles(mapDocs(snap) as Vehicle[]);
          }
        ),
      ];

      return () => unsubs.forEach((u) => u());
    }

    fetchItemsAndTransactions();
    const interval = setInterval(fetchItemsAndTransactions, 30000);
    return () => clearInterval(interval);
  }, [user?.id, normalizeItem, fetchItemsAndTransactions]);

  useEffect(() => subscribeDocumentPreview((docs) => setPrintPreviewDocs(docs)), []);

  useEffect(() => {
    if (items.length > 0 || transactions.length > 0) {
      const sid = getStoredActiveShopId();
      localStorage.setItem(`motorworld_items_${sid}`, JSON.stringify(items));
      localStorage.setItem(`motorworld_transactions_${sid}`, JSON.stringify(transactions));
    }
  }, [items, transactions]);

  // --- Derived Data for Inventory View ---
  const categories = useMemo(() => {
    const cats = new Set(items.map(i => i.category));
    return ['All', ...Array.from(cats)].filter(Boolean).sort();
  }, [items]);

  const itemNames = useMemo(() => {
    const filteredByCat = categoryFilter === 'All' 
        ? items 
        : items.filter(i => i.category === categoryFilter);
    const names = new Set(filteredByCat.map(i => i.name));
    return Array.from(names).sort();
  }, [items, categoryFilter]);

  const dropdownOptions = useMemo(() => {
      if (!searchFilter) return itemNames;
      return itemNames.filter(name => name.toLowerCase().includes(searchFilter.toLowerCase()));
  }, [itemNames, searchFilter]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
      const q = searchFilter.toLowerCase();
      const matchesSearch =
        item.name.toLowerCase().includes(q) ||
        (item.brand && item.brand.toLowerCase().includes(q)) ||
        (item.itemCode && item.itemCode.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [items, categoryFilter, searchFilter]);

  // --- Derived Data for History View ---
  const historyTransactions = useMemo(() => {
    return transactions.filter(t => {
      const tDate = new Date(t.timestamp);
      tDate.setHours(0,0,0,0);

      const start = historyStartDate ? new Date(historyStartDate) : null;
      if (start) start.setHours(0,0,0,0);

      const end = historyEndDate ? new Date(historyEndDate) : null;
      if (end) end.setHours(23,59,59,999);

      if (start && tDate < start) return false;
      if (end && tDate > end) return false;
      
      if (historyTypeFilter !== 'All') {
        if (historyTypeFilter === 'RETURN' && (t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES')) return true;
        if (t.type !== historyTypeFilter) return false;
      }

      return true;
    }).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [transactions, historyStartDate, historyEndDate, historyTypeFilter]);

  // --- Derived Data for Dashboard (Global Stats) ---
  // Using 'items' and 'transactions' directly for global view, not filtered ones
  const globalStats: DashboardStats = useMemo(() => {
    const now = new Date();
    const recentTx = transactions.filter(t =>
       (now.getTime() - new Date(t.timestamp).getTime()) < (7 * 24 * 60 * 60 * 1000)
    );
    const qty = (i: InventoryItem & { quantity?: number }) => {
      const v = Number(i.quantity);
      return Number.isFinite(v) ? v : 0;
    };
    const price = (i: InventoryItem & { unit_price?: number }) => {
      const v = Number((i as any).unitPrice ?? (i as any).unit_price ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const totalVal = items.reduce((acc, i) => acc + qty(i) * price(i), 0);

    return {
      totalItems: items.reduce((acc, i) => acc + qty(i), 0),
      totalInventoryValue: Number.isFinite(totalVal) ? totalVal : 0,
      lowStockCount: items.filter((i) => isLowStockItem(i)).length,
      recentActivityCount: recentTx.length
    };
  }, [items, transactions]);

  const lowStockItems = useMemo(() => {
    return items.filter((item) => isLowStockItem(item)).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const chequeReminders = useMemo(() => {
    function parseLocalDayStart(raw: string | null | undefined): number | null {
      const s = String(raw || '').trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const pending: Transaction[] = [];
    const bounced: Transaction[] = [];
    for (const t of transactions) {
      if (t.type !== 'RELEASE' || t.modeOfPayment !== 'Cheque') continue;
      const st = t.chequeStatus || 'pending';
      if (st === 'bounced') {
        bounced.push(t);
        continue;
      }
      if (st !== 'pending') continue;
      const clearMs = parseLocalDayStart(t.chequeExpectedClearDate);
      if (clearMs != null && clearMs <= todayMs) pending.push(t);
    }
    return { pending, bounced };
  }, [transactions]);

  const chartData = useMemo(() => {
     const last7Days = Array.from({length: 7}, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split('T')[0];
     });

     return last7Days.map(date => {
        const dayTrans = transactions.filter((t) => String(t.timestamp ?? '').startsWith(date));
        const added = dayTrans.filter(t => t.type === 'ADDITION' || t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES').reduce((sum, t) => sum + t.totalValue, 0);
        const released = dayTrans.filter(t => t.type === 'RELEASE' || t.type === 'ISSUE').reduce((sum, t) => sum + t.totalValue, 0);
        return {
            name: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
            added: added,
            released: released
        };
     });
  }, [transactions]);

  // --- Handlers ---
  const handleSelectItem = (name: string) => {
      setSearchFilter(name);
      setIsItemDropdownOpen(false);
  };

  const handleSaveItem = (itemData: Partial<InventoryItem>) => {
    const now = new Date().toISOString();
    const norm = (i: any) => ({ ...i, brand: i.brand ?? '', unit: i.unit ?? 'pcs' });

    if (itemToEdit) {
      return itemsApi
        .update(itemToEdit.id, {
          itemCode: itemData.itemCode ?? itemToEdit.itemCode,
          name: itemData.name ?? itemToEdit.name,
          brand: itemData.brand ?? itemToEdit.brand,
          category: itemData.category ?? itemToEdit.category,
          quantity: itemData.quantity ?? itemToEdit.quantity,
          unit: itemData.unit ?? itemToEdit.unit,
          unitPrice: itemData.unitPrice ?? itemToEdit.unitPrice,
          capitalPrice: itemData.capitalPrice ?? itemToEdit.capitalPrice ?? itemData.unitPrice ?? itemToEdit.unitPrice,
          description: itemData.description ?? itemToEdit.description,
          minStockLevel: itemData.minStockLevel ?? itemToEdit.minStockLevel,
          receiptNumber: itemData.receiptNumber !== undefined ? itemData.receiptNumber : itemToEdit.receiptNumber,
          stockPurpose: itemData.stockPurpose ?? itemToEdit.stockPurpose,
          lastUpdated: now,
        })
        .then((updated) => {
          setItems((prev) => prev.map((i) => (i.id === itemToEdit.id ? (norm(updated) as InventoryItem) : i)));
          // Server PUT already records ADJUSTMENT when quantity changes; refresh ledger to avoid duplicates.
          fetchItemsAndTransactions();
          setInventoryFeedback({ message: `Updated ${updated.name}.`, variant: 'success' });
          setItemToEdit(undefined);
        })
        .catch((err) => {
          throw new Error(err instanceof Error ? err.message : 'Failed to save item.');
        });
    } else {
      return itemsApi
        .create({
          itemCode: itemData.itemCode,
          name: itemData.name || 'New Item',
          brand: itemData.brand ?? '',
          category: itemData.category || 'Uncategorized',
          quantity: itemData.quantity ?? 0,
          unit: itemData.unit ?? 'pcs',
          unitPrice: itemData.unitPrice ?? 0,
          capitalPrice: itemData.capitalPrice ?? itemData.unitPrice ?? 0,
          description: itemData.description ?? '',
          minStockLevel: itemData.minStockLevel ?? 0,
          receiptNumber: itemData.receiptNumber,
        })
        .then((created) => {
          const newItem = norm(created) as InventoryItem;
          setItems((prev) => [...prev, newItem]);
          const cap = Number(created.capitalPrice ?? created.unitPrice);
          const transaction: Transaction = {
            id: crypto.randomUUID(),
            itemId: created.id,
            itemName: created.name,
            type: 'ADDITION',
            quantityChange: created.quantity,
            unitPriceAtTime: cap,
            sellingPriceAtTime: Number(created.unitPrice),
            totalValue: created.quantity * cap,
            timestamp: now,
            note: 'Initial Stock',
            receiptNumber: created.receiptNumber,
          };
          setTransactions((prev) => [transaction, ...prev]);
        })
        .catch((err) => {
          throw new Error(err instanceof Error ? err.message : 'Failed to create item.');
        });
    }
  };

  const deleteInventoryItem = (item: InventoryItem) => {
    const label = item.itemCode?.trim() || item.name;
    if (!window.confirm(`Delete "${label}" from inventory? This cannot be undone.`)) {
      return Promise.resolve();
    }
    return itemsApi
      .delete(item.id)
      .then(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        if (itemToEdit?.id === item.id) {
          setItemToEdit(undefined);
          setIsAddModalOpen(false);
        }
        setInventoryFeedback({ message: `Deleted ${label}.`, variant: 'success' });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Could not delete item.';
        setInventoryFeedback({ message, variant: 'error' });
        throw new Error(message);
      });
  };

  const handleDeleteItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) {
      setInventoryFeedback({ message: 'Item not found.', variant: 'error' });
      return;
    }
    void deleteInventoryItem(item);
  };

  const handleReleaseItem = (
    itemType: 'Product' | 'Service',
    itemId: string | null,
    itemName: string,
    qty: number,
    price: number,
    recipient: string,
    note: string,
    modeOfPayment: string,
    modeOfPaymentOther?: string,
    dueDays?: number,
    creditOptions?: { downPayment: number; interestRate: number; paymentSchedule: 'weekly' | 'monthly' },
    personId?: string,
    vehicleId?: string,
    transactionDateYmd?: string
  ) => {
     const saleTimestamp = dateInputToIsoTimestamp(transactionDateYmd || todayDateInputValue());
     const transaction: Transaction = {
        id: crypto.randomUUID().slice(0, 8).toUpperCase(),
        itemId: itemId ?? undefined,
        itemName: itemName,
        type: 'RELEASE',
        quantityChange: -qty,
        unitPriceAtTime: price,
        totalValue: qty * price,
        timestamp: saleTimestamp,
        recipient: recipient,
        note: note,
        modeOfPayment: modeOfPayment,
        modeOfPaymentOther: modeOfPayment === 'Others' ? modeOfPaymentOther : undefined,
        personId: personId ?? null,
        vehicleId: vehicleId ?? null,
        itemType: itemType,
     };
     const createPayload = {
       ...transaction,
       transactionDate: saleTimestamp,
       itemType,
       dueDays: modeOfPayment === 'Credit' ? dueDays : undefined,
       downPayment: creditOptions?.downPayment,
       interestRate: creditOptions?.interestRate,
       paymentSchedule: creditOptions?.paymentSchedule,
       personId: personId ?? undefined,
       vehicleId: vehicleId ?? undefined,
     };
     // Stock validation and deduction are done on the backend; frontend only calls API and refreshes items on success.
    return transactionsApi
       .create(createPayload)
       .then((created) => {
         setTransactions((prev) => [created, ...prev]);
         if (canEdit) activityApi.log('RELEASE', { itemType, itemId: itemId ?? undefined, itemName, quantity: qty, recipient }).catch(() => {});
         return itemsApi.list();
       })
       .then((itemsRes) => setItems((itemsRes.items ?? []).map((i: any) => normalizeItem(i))))
      .catch((err) => {
        throw new Error(err instanceof Error ? err.message : 'Failed to release item.');
      });
  };

  const handleIssueItem = (itemId: string, qty: number, price: number, recipient: string, note: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return Promise.reject(new Error('Item not found.'));
    const now = new Date().toISOString();
    const transaction = {
      id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      itemId: item.id,
      itemName: item.name,
      type: 'ISSUE',
      quantityChange: -qty,
      unitPriceAtTime: price,
      totalValue: qty * price,
      timestamp: now,
      recipient: recipient,
      note: note,
      itemType: 'Product' as const,
    };
    return transactionsApi
      .create(transaction)
      .then((created) => {
        setTransactions(prev => [created as Transaction, ...prev]);
        return itemsApi.list();
      })
      .then((itemsRes) => setItems((itemsRes.items ?? []).map((i: any) => normalizeItem(i))))
      .catch((err) => {
        throw new Error(err instanceof Error ? err.message : 'Failed to issue item.');
      });
  };

  const handleReturnItem = (itemId: string, qty: number, note: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return Promise.reject(new Error('Item not found.'));
    const now = new Date().toISOString();
    const transaction = {
      id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      itemId: item.id,
      itemName: item.name,
      type: 'RETURN',
      quantityChange: qty,
      unitPriceAtTime: item.unitPrice,
      totalValue: qty * item.unitPrice,
      timestamp: now,
      note: note,
      itemType: 'Product' as const,
    };
    return transactionsApi
      .create(transaction)
      .then((created) => {
        setTransactions(prev => [created as Transaction, ...prev]);
        return itemsApi.list();
      })
      .then((itemsRes) => setItems((itemsRes.items ?? []).map((i: any) => normalizeItem(i))))
      .catch((err) => {
        throw new Error(err instanceof Error ? err.message : 'Failed to return item.');
      });
  };

  const handleReturnFromSales = (
    releaseTransactionId: string,
    returnQuantity: number,
    reason: NonNullable<Transaction['returnReason']>,
    reasonOthers: string | undefined,
    condition: 'restock' | 'defective',
    returnReasonText: string
  ) => {
    return transactionsApi
      .returnFromSales({
        releaseTransactionId,
        returnQuantity,
        reason,
        reasonOthers,
        condition,
        returnReasonText,
      })
      .then((returnTx: unknown) => {
        const t = returnTx as Transaction;
        setTransactions((prev) => [t, ...prev]);
        const item = items.find((i) => i.id === t.itemId);
        if (item) {
          if (condition === 'restock') {
            setItems((prev) =>
              prev.map((i) =>
                i.id === t.itemId
                  ? { ...i, quantity: i.quantity + returnQuantity, lastUpdated: new Date().toISOString() }
                  : i
              )
            );
          } else {
            setItems((prev) =>
              prev.map((i) =>
                i.id === t.itemId
                  ? {
                      ...i,
                      defectiveQuantity: (i.defectiveQuantity ?? 0) + returnQuantity,
                      lastUpdated: new Date().toISOString(),
                    }
                  : i
              )
            );
          }
        }
        if (canEdit) {
          activityApi
            .log('RETURN_FROM_SALES', {
              itemId: t.itemId,
              itemName: t.itemName,
              quantity: returnQuantity,
              returnReason: returnReasonText,
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        console.error('Return from sales failed:', err);
        throw new Error(err instanceof Error ? err.message : 'Return from sales failed.');
      });
  };

  const handleAddStock = (
    itemId: string,
    qty: number,
    capitalPerUnit: number,
    sellingPerUnit: number,
    note: string,
    receiptNumber: string
  ) => {
      const item = items.find(i => i.id === itemId);
      if (!item) return Promise.reject(new Error('Item not found.'));
      const now = new Date().toISOString();
      const transaction = {
          id: crypto.randomUUID().slice(0, 8).toUpperCase(),
          itemId: item.id,
          itemName: item.name,
          type: 'ADDITION' as const,
          quantityChange: qty,
          unitPriceAtTime: capitalPerUnit,
          sellingPriceAtTime: sellingPerUnit,
          totalValue: qty * capitalPerUnit,
          timestamp: now,
          note: note.trim() || 'Restock (add stock)',
          receiptNumber: receiptNumber,
          itemType: 'Product' as const,
      };
      return transactionsApi
        .create(transaction)
        .then((created) => {
          setTransactions(prev => [created as Transaction, ...prev]);
          return itemsApi.list();
        })
        .then((itemsRes) => setItems((itemsRes.items ?? []).map((i: any) => normalizeItem(i))))
        .catch((err) => {
          throw new Error(err instanceof Error ? err.message : 'Failed to add stock.');
        });
  };

  const handlePatchAddition = (
    id: string,
    body: {
      quantityChange: number;
      unitPriceAtTime: number;
      sellingPriceAtTime: number;
      note: string;
      receiptNumber: string;
      editSummary: string;
    }
  ) =>
    transactionsApi
      .patchAddition(id, {
        quantityChange: body.quantityChange,
        unitPriceAtTime: body.unitPriceAtTime,
        sellingPriceAtTime: body.sellingPriceAtTime,
        note: body.note,
        receiptNumber: body.receiptNumber,
        editSummary: body.editSummary,
      })
      .then((updated) => {
        setTransactions((prev) => prev.map((t) => (t.id === id ? (updated as Transaction) : t)));
        return itemsApi.list();
      })
      .then((itemsRes) => setItems((itemsRes.items ?? []).map((i: any) => normalizeItem(i))))
      .catch((err) => {
        throw new Error(err instanceof Error ? err.message : 'Failed to update restock entry.');
      });

  // Fixed: Added missing modal handler functions
  const openEditModal = (item: InventoryItem) => {
    setItemToEdit(item);
    setIsAddModalOpen(true);
  };

  const openReleaseModal = (item: InventoryItem) => {
    setItemToRelease(item);
    setIsReleaseModalOpen(true);
  };

  const openAddStockModal = (item: InventoryItem) => {
    setItemToAddStock(item);
    setIsAddStockModalOpen(true);
  };

  const openIssueModal = (item: InventoryItem) => {
    setItemToIssue(item);
    setIsIssueModalOpen(true);
  };

  const openReturnModal = (item: InventoryItem) => {
    setItemToReturn(item);
    setIsReturnModalOpen(true);
  };

  // --- Printing ---
  const printInventory = () => {
    const win = window.open('', '', 'width=900,height=650');
    if (!win) return;
    const rows = filteredItems.map(item => `
      <tr>
        <td>${item.itemCode || '—'}</td>
        <td>${item.category}</td>
        <td>${item.name}</td>
        <td>${item.brand || '—'}</td>
        <td>${item.unit || 'pcs'}</td>
        <td style="text-align:right">${item.quantity}</td>
        <td style="text-align:right">₱${item.unitPrice.toFixed(2)}</td>
        <td style="text-align:right">₱${(item.quantity * item.unitPrice).toFixed(2)}</td>
      </tr>
    `).join('');
    const totalValue = filteredItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);
    win.document.write(`
      <html>
        <head>
          <title>Inventory List</title>
          <style>
            body { font-family: sans-serif; padding: 20px; color: #333; }
            h1 { text-align: center; margin-bottom: 5px; color: #1e293b; }
            p.date { text-align: center; margin-bottom: 20px; color: #64748b; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
            th { background-color: #f8fafc; font-weight: bold; text-transform: uppercase; color: #475569; }
            tr:nth-child(even) { background-color: #f8fafc; }
            .total { text-align: right; margin-top: 20px; font-weight: bold; font-size: 16px; }
          </style>
        </head>
        <body>
          <h1>Inventory Status Report</h1>
          <p class="date">Generated on ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr><th>Item code</th><th>Product type</th><th>Product name</th><th>Brand</th><th>UOM</th><th align="right">Qty</th><th align="right">Price</th><th align="right">Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="total">Total Value: ₱${totalValue.toLocaleString()}</div>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const printHistoryLog = () => {
    const win = window.open('', '', 'width=900,height=650');
    if (!win) return;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = historyTransactions.map(t => `
      <tr>
        <td>
           ${new Date(t.timestamp).toLocaleDateString()}<br/>
           <span style="font-size:10px;color:#666">ID: #${t.id.slice(0,8)}</span>
           ${t.receiptNumber ? `<br/><span style="font-size:10px;font-weight:bold;color:#4f46e5">OR: ${esc(String(t.receiptNumber))}</span>` : ''}
           ${t.type === 'ADDITION' && t.editedAt ? `<br/><span style="font-size:10px;color:#b45309;font-weight:600">Edited ${esc(new Date(t.editedAt).toLocaleString())}</span>${t.editNote ? `<br/><span style="font-size:10px;color:#64748b">${esc(String(t.editNote))}</span>` : ''}` : ''}
        </td>
        <td>${t.type === 'ADDITION' ? 'ADDITION (restock)' : t.type}</td>
        <td>${esc(String(t.itemName || ''))}</td>
        <td>${t.recipient ? esc(String(t.recipient)) : '-'}</td>
        <td style="text-align:right">${Math.abs(t.quantityChange)}</td>
        <td style="text-align:right">₱${t.totalValue.toFixed(2)}</td>
      </tr>
    `).join('');
    
    let titleType = 'All Activity';
    if (historyTypeFilter === 'RELEASE') titleType = 'Released Items (Out)';
    if (historyTypeFilter === 'ISSUE') titleType = 'Issued Items (Out)';
    if (historyTypeFilter === 'ADDITION') titleType = 'Arrived Items (In)';
    if (historyTypeFilter === 'RETURN') titleType = 'Returned Items (In)';
    if (historyTypeFilter === 'ADJUSTMENT') titleType = 'Stock Adjustments';

    const printBrand = workspaceBrand(getStoredActiveShopId(), USE_FIRESTORE_ADMIN_DATA);

    win.document.write(`
      <html>
        <head>
          <title>History - ${titleType}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; color: #333; }
            h1 { text-align: center; margin-bottom: 5px; color: #1e293b; }
            p.date { text-align: center; margin-bottom: 20px; color: #64748b; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
            th { background-color: #f8fafc; font-weight: bold; text-transform: uppercase; color: #475569; }
            tr:nth-child(even) { background-color: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>${esc(printBrand.title)} — ${titleType}</h1>
          <p class="date">Period: ${historyStartDate || 'Start'} to ${historyEndDate || 'Present'} | Generated: ${new Date().toLocaleDateString()}</p>
          <table>
            <thead>
              <tr><th>Date/ID</th><th>Type</th><th>Item</th><th>Recipient</th><th align="right">Qty</th><th align="right">Value</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const viewMeta: Record<AppView, { title: string; description: string }> = {
    dashboard: {
      title: 'Dashboard',
      description: 'Track stock, activity, and business movement from one coordinated workspace.',
    },
    sales_summary: {
      title: 'Sales summary',
      description: 'Monthly revenue, COGS, discounts, gross profit, expenses, and net income using the same P&L order as standard sales summary reports.',
    },
    billing_statement: {
      title: 'Billing statement',
      description: 'Motor World–style billing grid: materials lines, discounts, totals, and printable statement.',
    },
    inventory: {
      title: 'Inventory Management',
      description: 'Search, filter, and manage live stock with faster action access.',
    },
    purchasing: {
      title: 'Purchasing',
      description: 'Manage supplier receiving, purchase records, and inbound stock flow.',
    },
    pos: {
      title: 'POS',
      description: 'Handle releases, customer transactions, and service sales in one place.',
    },
    history: {
      title: 'Transaction History',
      description: 'Review item movement, dates, payment modes, and printable records.',
    },
    document_archives: {
      title: 'Document archive',
      description: 'Search saved POS receipts and billing snapshots, preview, print, and correct labels.',
    },
    item_details: {
      title: 'Item Details',
      description: 'Inspect deeper per-item activity and related inventory information.',
    },
    receivables: {
      title: 'Receivables',
      description: 'Customer balances from credit sales, payments, and the payment journal.',
    },
    accounts: {
      title: 'Accounts',
      description: 'Maintain the person and vehicle records used across operations.',
    },
    expenses: {
      title: 'Expenses',
      description: 'Track outgoing costs alongside inventory and purchasing activity.',
    },
    activity_log: {
      title: 'Activity Log',
      description: 'Audit important actions across users and operational changes.',
    },
    manage_users: {
      title: 'Manage Users',
      description: 'Control account access and permissions for this system.',
    },
    online_bookings: {
      title: 'Online bookings',
      description: 'Website service requests — confirm to create customer records and service sales.',
    },
    employee_salary: {
      title: 'Employee salary',
      description: 'Import DTR Excel, compute payroll from attendance, and post salaries as company expenses.',
    },
  };

  const activeShopId = getStoredActiveShopId();
  const isMotorWorldShop = activeShopId === 'motorworld';

  const navigationSections: Array<{
    title: string;
    items: Array<{ id: AppView; label: string; icon: typeof LayoutDashboard }>;
  }> = [
    {
      title: 'Overview',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'sales_summary', label: 'Sales summary', icon: FileSpreadsheet },
        { id: 'billing_statement', label: 'Billing statement', icon: FileText },
        { id: 'inventory', label: 'Inventory', icon: Package },
        { id: 'history', label: 'History Log', icon: History },
        { id: 'document_archives', label: 'Document archive', icon: Archive },
        { id: 'item_details', label: 'Item Details', icon: ClipboardList },
      ],
    },
    {
      title: 'Operations',
      items: [
        { id: 'purchasing', label: 'Purchasing', icon: Truck },
        { id: 'pos', label: 'POS', icon: ShoppingBag },
        ...(isMotorWorldShop
          ? [{ id: 'online_bookings' as AppView, label: 'Online bookings', icon: CalendarClock }]
          : []),
        { id: 'receivables', label: 'Receivables', icon: CreditCard },
        { id: 'accounts', label: 'Accounts', icon: UserCircle },
        { id: 'expenses', label: 'Expenses', icon: Receipt },
        { id: 'employee_salary', label: 'Employee salary', icon: Wallet },
      ],
    },
    ...(isAdmin
      ? [
          {
            title: 'Administration',
            items: [
              { id: 'activity_log' as AppView, label: 'Activity Log', icon: ScrollText },
              { id: 'manage_users' as AppView, label: 'Manage Users', icon: Users },
            ],
          },
        ]
      : []),
  ];

  const activeViewMeta = viewMeta[view];
  const flatNavigationItems = navigationSections.flatMap((section) => section.items);
  const shellBrand = workspaceBrand(getStoredActiveShopId(), USE_FIRESTORE_ADMIN_DATA);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.38),_rgba(248,250,252,1)_38%,_rgba(224,231,255,0.3)_100%)] text-slate-900 font-sans">
      <div className="mx-auto flex min-h-screen max-w-[1720px] gap-4 px-3 py-3 sm:gap-6 sm:px-4 lg:px-6">
        <aside className="hidden w-[292px] shrink-0 lg:flex">
          <DashboardSurface tone="dark" className="sticky top-3 flex h-[calc(100vh-1.5rem)] w-full flex-col p-5">
            <div className="flex items-center gap-3 border-b border-slate-600 pb-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 shadow-[0_22px_35px_-24px_rgba(129,140,248,0.9)]">
                <Shield className="h-7 w-7 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="break-words text-sm font-semibold leading-snug text-white">
                  {shellBrand.title}
                </h1>
                <p className="text-xs text-slate-200">{shellBrand.tagline}</p>
              </div>
            </div>

            <div className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
              {navigationSections.map((section) => (
                <div key={section.title}>
                  <p className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-300">
                    {section.title}
                  </p>
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <DashboardNavButton
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={view === item.id}
                        onClick={() => setView(item.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-600 bg-slate-800/80 p-4">
              {!USE_FIRESTORE_ADMIN_DATA && user?.shops && user.shops.length > 0 && (
                <div className="mb-4 border-b border-slate-600 pb-4">
                  <label className="flex flex-col gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <span>Store — one tab per location</span>
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-xs font-semibold normal-case tracking-normal text-white"
                      value={getStoredActiveShopId()}
                      title="Each browser tab has its own store. Use “Open in new tab” to run two stores at once."
                      onChange={handleShopChange}
                    >
                      {user.shops.map((id) => {
                        const meta = SHOPS.find((s) => s.id === id);
                        return (
                          <option key={id} value={id}>
                            {meta?.shortLabel ?? id}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {user.shops.length > 1 && (
                    <div className="mt-3 space-y-1.5 text-[11px] font-normal normal-case tracking-normal text-slate-300">
                      <p className="text-slate-400">Also open:</p>
                      <div className="flex flex-col gap-1">
                        {user.shops
                          .filter((id) => id !== getStoredActiveShopId())
                          .map((id) => {
                            const meta = SHOPS.find((s) => s.id === id);
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => openOtherStoreInNewTab(id)}
                                className="inline-flex items-center gap-1 text-left text-indigo-200 underline-offset-2 hover:text-white hover:underline"
                              >
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                                {meta?.shortLabel ?? id} (new tab)
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">Logged in</p>
              <p className="mt-2 truncate text-sm font-medium text-white" title={user?.displayName}>
                {user?.displayName || 'User'}
              </p>
              <p className="mt-1 text-xs text-slate-200">
                {user?.role === 'overseer' ? 'Overseer' : 'Administrator'}
              </p>
              <Button
                onClick={() => logout()}
                variant="ghost"
                className="mt-2 w-full justify-start bg-slate-700/80 text-slate-100 hover:bg-slate-700 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
              <Button
                onClick={() => setChangePasswordOpen(true)}
                variant="ghost"
                className="mt-2 w-full justify-start bg-slate-700/80 text-slate-100 hover:bg-slate-700 hover:text-white"
              >
                <KeyRound className="h-4 w-4" />
                Change password
              </Button>
            </div>
          </DashboardSurface>
        </aside>

        <main className="min-w-0 flex-1 py-1">
          {user && (chequeReminders.pending.length > 0 || chequeReminders.bounced.length > 0) && (
            <div className="mb-4 px-1">
              <DashboardSurface className="border-amber-200 bg-amber-50/95 p-4 text-sm text-amber-950">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1 min-w-0">
                    <p className="font-semibold text-amber-950 flex items-center gap-2">
                      <AlertOctagon className="h-4 w-4 shrink-0" />
                      Cheque follow-up
                    </p>
                    {chequeReminders.pending.length > 0 && (
                      <p>
                        {chequeReminders.pending.length} cheque{chequeReminders.pending.length === 1 ? '' : 's'} at or past the
                        expected bank clearance date — mark cleared or bounced under Receivables.
                      </p>
                    )}
                    {chequeReminders.bounced.length > 0 && (
                      <p>
                        {chequeReminders.bounced.length} bounced cheque{chequeReminders.bounced.length === 1 ? '' : 's'} still on
                        accounts receivable until you collect or clear them.
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    className="shrink-0 self-start"
                    onClick={() => setView('receivables')}
                  >
                    Open receivables
                  </Button>
                </div>
              </DashboardSurface>
            </div>
          )}
          <div className="mb-4 lg:hidden">
            <DashboardSurface tone="dark" className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                    {shellBrand.title}
                  </p>
                  <h1 className="truncate text-lg font-semibold text-white">{activeViewMeta.title}</h1>
                  <p className="mt-1 text-sm text-slate-200">{activeViewMeta.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!USE_FIRESTORE_ADMIN_DATA && user?.shops && user.shops.length > 0 && (
                    <label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      <span className="hidden sm:inline">Store</span>
                      <select
                        className="max-w-[140px] rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-white sm:max-w-[220px]"
                        value={getStoredActiveShopId()}
                        title="Each browser tab has its own store. Use the links below to open the other location in a new tab."
                        onChange={handleShopChange}
                      >
                        {user.shops.map((id) => {
                          const meta = SHOPS.find((s) => s.id === id);
                          return (
                            <option key={id} value={id}>
                              {meta?.shortLabel ?? id}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  )}
                  <Button
                    onClick={() => logout()}
                    variant="ghost"
                    className="shrink-0 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1] hover:text-white"
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => setChangePasswordOpen(true)}
                    variant="ghost"
                    className="shrink-0 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1] hover:text-white"
                    title="Change password"
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {flatNavigationItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={cx(
                      'shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors',
                      view === item.id
                        ? 'border-indigo-400/30 bg-white text-slate-900'
                        : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </DashboardSurface>
          </div>

          <DashboardSurface className="relative z-10 mb-6 p-5 sm:p-6">
            <DashboardSectionHeader
              eyebrow="Workspace"
              title={activeViewMeta.title}
              description={activeViewMeta.description}
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isAdmin && <NotificationsBell />}
                  {canEdit && (
                    <>
                      <Button onClick={() => setIsReturnFromSalesModalOpen(true)} variant="secondary">
                        <RotateCcw className="h-4 w-4" />
                        Sales Return
                      </Button>
                      <Button onClick={() => { setItemToEdit(undefined); setIsAddModalOpen(true); }} variant="primary">
                        <Plus className="h-4 w-4" />
                        Add New Item
                      </Button>
                    </>
                  )}
                </div>
              }
            />
          </DashboardSurface>

          {view === 'dashboard' && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatsCard
                  title="Inventory Value"
                  value={`₱${globalStats.totalInventoryValue.toLocaleString()}`}
                  icon={PhilippinePeso}
                  colorClass="bg-green-500"
                />
                <StatsCard
                  title="Items in Stock"
                  value={globalStats.totalItems}
                  icon={Package}
                  colorClass="bg-blue-500"
                />
                <StatsCard
                  title="Low Stock Alerts"
                  value={globalStats.lowStockCount}
                  icon={AlertOctagon}
                  colorClass="bg-amber-500"
                  trend={globalStats.lowStockCount > 0 ? 'Needs attention' : 'Healthy level'}
                  trendUp={globalStats.lowStockCount === 0}
                />
                <StatsCard
                  title="Recent Activity"
                  value={globalStats.recentActivityCount}
                  icon={Activity}
                  colorClass="bg-purple-500"
                />
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
                <DashboardSurface className="p-5 sm:p-6">
                  <DashboardSectionHeader
                    eyebrow="Sales Overview"
                    title="Weekly Value Flow"
                    description="Monitor inbound and outbound inventory value over the last seven days."
                  />
                  <div className="mt-6 h-[340px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorAdded" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#34d399" stopOpacity={0.55} />
                            <stop offset="95%" stopColor="#34d399" stopOpacity={0.03} />
                          </linearGradient>
                          <linearGradient id="colorReleased" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.55} />
                            <stop offset="95%" stopColor="#818cf8" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `₱${value}`}
                        />
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            borderRadius: '18px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 20px 40px -24px rgba(15, 23, 42, 0.35)',
                          }}
                          itemStyle={{ fontSize: '12px', fontWeight: '500' }}
                          formatter={(value: number) => [`₱${value}`, '']}
                        />
                        <Area type="monotone" dataKey="added" stroke="#34d399" fillOpacity={1} fill="url(#colorAdded)" name="Value Added" />
                        <Area
                          type="monotone"
                          dataKey="released"
                          stroke="#818cf8"
                          fillOpacity={1}
                          fill="url(#colorReleased)"
                          name="Value Released"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </DashboardSurface>

                <div className="space-y-6">
                  <DashboardSurface className="p-5 sm:p-6">
                    <DashboardSectionHeader
                      eyebrow="Activity"
                      title="Recent Movement"
                      description="Latest inventory changes across release, issue, return, and additions."
                    />
                    <div className="mt-5 space-y-3">
                      {transactions.slice(0, 5).map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/90 px-4 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={cx(
                                'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                                t.type === 'ADDITION'
                                  ? 'bg-emerald-100 text-emerald-600'
                                  : t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES'
                                    ? 'bg-teal-100 text-teal-600'
                                    : t.type === 'RELEASE'
                                      ? 'bg-orange-100 text-orange-600'
                                      : t.type === 'ISSUE'
                                        ? 'bg-indigo-100 text-indigo-600'
                                        : 'bg-sky-100 text-sky-600'
                              )}
                            >
                              {(t.type === 'ADDITION' || t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES') && (
                                <ArrowDownLeft className="h-4 w-4" />
                              )}
                              {(t.type === 'RELEASE' || t.type === 'ISSUE') && <ArrowUpRight className="h-4 w-4" />}
                              {t.type === 'ADJUSTMENT' && <Activity className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{t.itemName}</p>
                              <p className="truncate text-xs text-slate-500">
                                {t.type === 'RELEASE' && `Released to ${t.recipient || 'Unknown'}`}
                                {t.type === 'ISSUE' && `Issued to ${t.recipient || 'Unknown'}`}
                                {t.type === 'ADDITION' && 'Stock added'}
                                {(t.type === 'RETURN' || t.type === 'RETURN_FROM_SALES') && 'Returned to stock'}
                                {t.type === 'ADJUSTMENT' && 'Stock adjusted'}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-slate-900">
                              {(t.type === 'RELEASE' || t.type === 'ISSUE') ? '-' : '+'}
                              {Math.abs(t.quantityChange)}
                            </p>
                            <p className="text-xs text-slate-400">{new Date(t.timestamp).toLocaleDateString()}</p>
                          </div>
                        </div>
                      ))}
                      {transactions.length === 0 && <p className="text-center text-sm text-slate-400">No activity yet.</p>}
                    </div>
                  </DashboardSurface>

                  <DashboardSurface className="p-5 sm:p-6">
                    <DashboardSectionHeader
                      eyebrow="Stock"
                      title="Low Stock Watchlist"
                      description="Items currently at or below their minimum stock level."
                    />
                    <div className="mt-5 space-y-3">
                      {lowStockItems.slice(0, 5).map((item) => (
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
                              {item.quantity} {item.unit || 'pcs'}
                            </p>
                            <p className="text-xs text-slate-400">Alert ≤ {formatLowStockAlertThreshold(item.minStockLevel)}</p>
                          </div>
                        </div>
                      ))}
                      {lowStockItems.length === 0 && (
                        <p className="text-center text-sm text-slate-400">No low-stock items right now.</p>
                      )}
                    </div>
                  </DashboardSurface>
                </div>
              </div>
            </div>
          )}

        {/* --- INVENTORY VIEW --- */}
        {view === 'sales_summary' && (
          <div>
            <SalesSummaryReportView transactions={transactions} items={items} />
          </div>
        )}
        {view === 'billing_statement' && (
          <div className="animate-fade-in">
            <BillingStatementView />
          </div>
        )}
        {view === 'purchasing' && (
          <div>
            <PurchasingView canEdit={canEdit} onReceiveComplete={fetchItemsAndTransactions} />
          </div>
        )}
        {view === 'pos' && (
          <div>
            <POSView
              items={items}
              persons={persons}
              vehicles={vehicles}
              canEdit={canEdit}
              onSaleComplete={fetchItemsAndTransactions}
            />
          </div>
        )}
        {view === 'online_bookings' && (
          <div>
            <OnlineBookingsView
              canEdit={canEdit}
              isMotorWorldShop={isMotorWorldShop}
              onBookingConfirmed={fetchItemsAndTransactions}
            />
          </div>
        )}
        {view === 'inventory' && (
           <div className="animate-fade-in">
             {inventoryFeedback && (
               <div className="mb-4">
                 <InlineAlert
                   message={inventoryFeedback.message}
                   variant={inventoryFeedback.variant === 'error' ? 'error' : 'success'}
                 />
               </div>
             )}
             <DashboardSurface className="relative z-20 mb-6 p-4">
               <div className="flex flex-col items-center gap-4 md:flex-row">
                <div className="relative flex-1 w-full">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input 
                      type="text" 
                      placeholder="Search or select item..." 
                      className="w-full pl-10 pr-10 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm placeholder-slate-400"
                      value={searchFilter}
                      onChange={(e) => {
                          setSearchFilter(e.target.value);
                          setIsItemDropdownOpen(true);
                      }}
                      onFocus={() => setIsItemDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setIsItemDropdownOpen(false), 200)}
                    />
                    <button onClick={() => setIsItemDropdownOpen(!isItemDropdownOpen)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
                        <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  {isItemDropdownOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto animate-fade-in">
                          {dropdownOptions.length > 0 ? (
                              dropdownOptions.map(name => (
                                  <button
                                      key={name}
                                      className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm text-slate-700 focus:bg-indigo-50 focus:outline-none"
                                      onClick={() => handleSelectItem(name)}
                                      onMouseDown={(e) => {
                                          e.preventDefault(); 
                                          handleSelectItem(name);
                                      }}
                                  >
                                      {name}
                                  </button>
                              ))
                          ) : (
                              <div className="px-4 py-3 text-sm text-slate-400 text-center">No matching items found</div>
                          )}
                      </div>
                  )}
                </div>

                <div className="relative min-w-[200px] w-full md:w-auto">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <select
                    className="w-full pl-10 pr-4 py-2 bg-white text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none text-sm cursor-pointer"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                {(categoryFilter !== 'All' || searchFilter !== '') && (
                  <Button
                    onClick={() => { setCategoryFilter('All'); setSearchFilter(''); }}
                    variant="ghost"
                    className="whitespace-nowrap text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <XCircle className="w-4 h-4" />
                    Clear Filters
                  </Button>
                )}
                
                <div className="w-px h-6 bg-slate-200 hidden md:block"></div>

                <Button variant="secondary" onClick={printInventory} className="whitespace-nowrap">
                    <Printer className="w-4 h-4" />
                    Print List
                </Button>
                {canEdit && (
                  <Button
                    variant="secondary"
                    onClick={() => setIsImportModalOpen(true)}
                    className="whitespace-nowrap"
                  >
                    <Upload className="w-4 h-4" />
                    Import price list
                  </Button>
                )}
               </div>
             </DashboardSurface>

             <InventoryTable 
                items={filteredItems} 
                onEdit={openEditModal} 
                onRelease={openReleaseModal} 
                onIssue={openIssueModal} 
                onReturn={openReturnModal} 
                onAddStock={openAddStockModal} 
                onDelete={handleDeleteItem}
                canEdit={canEdit}
             />
           </div>
        )}

        {/* --- HISTORY VIEW --- */}
        {view === 'history' && (
           <div className="animate-fade-in">
             <DashboardSurface className="mb-6 p-4">
               <div className="flex flex-col items-center gap-4 xl:flex-row">
                
                <div className="flex flex-col md:flex-row items-center gap-2 flex-1 w-full">
                    <div className="flex items-center gap-2 text-slate-600 font-medium whitespace-nowrap">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">Filter Activity:</span>
                    </div>
                    
                    <select
                        className="w-full md:w-auto px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={historyTypeFilter}
                        onChange={(e) => setHistoryTypeFilter(e.target.value)}
                    >
                        <option value="All">All Types</option>
                        <option value="RELEASE">Items Released (Out)</option>
                        <option value="ISSUE">Items Issued (Out)</option>
                        <option value="ADDITION">Items Arrived (In)</option>
                        <option value="RETURN">Items Returned (In)</option>
                        <option value="ADJUSTMENT">Adjustments</option>
                    </select>

                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <input 
                            type="date" 
                            className="w-full md:w-auto px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={historyStartDate}
                            onChange={(e) => setHistoryStartDate(e.target.value)}
                        />
                        <span className="text-slate-400">-</span>
                        <input 
                            type="date" 
                            className="w-full md:w-auto px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={historyEndDate}
                            onChange={(e) => setHistoryEndDate(e.target.value)}
                        />
                    </div>
                    
                    {(historyStartDate || historyEndDate || historyTypeFilter !== 'All') && (
                        <Button
                            onClick={() => { setHistoryStartDate(''); setHistoryEndDate(''); setHistoryTypeFilter('All'); }}
                            variant="ghost"
                            className="ml-2 whitespace-nowrap text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                            Clear
                        </Button>
                    )}
                </div>

                <Button variant="secondary" onClick={printHistoryLog} className="whitespace-nowrap">
                    <Printer className="w-4 h-4" />
                    Print Log
                </Button>
               </div>
             </DashboardSurface>

             <HistoryTable
               transactions={historyTransactions}
               persons={persons}
               vehicles={vehicles}
               onReturnFromSalesClick={canEdit ? (releaseId) => { setInitialReleaseIdForReturn(releaseId); setIsReturnFromSalesModalOpen(true); } : undefined}
               onOpenBillingStatementPrint={(t) => setBillingStatementPrintTx(t)}
               onEditAddition={canEdit ? (t) => setTransactionToEditAddition(t) : undefined}
             />
           </div>
        )}

        {view === 'document_archives' && (
          <div className="animate-fade-in">
            <DocumentArchivesView canEdit={canEdit} />
          </div>
        )}
        
        {/* --- ITEM DETAILS VIEW --- */}
        {view === 'item_details' && (
           <div className="animate-fade-in">
             <ItemDetails items={items} transactions={transactions} />
           </div>
        )}

        {/* --- LOANS / CREDIT MANAGEMENT --- */}
        {view === 'receivables' && (
          <div className="animate-fade-in">
            <LoanManagementView transactions={transactions} onReceivablesChanged={fetchItemsAndTransactions} />
          </div>
        )}

        {/* --- ACCOUNTS (Person & Vehicle) --- */}
        {view === 'accounts' && (
          <AccountsView canEdit={canEdit} />
        )}

        {/* --- EXPENSES --- */}
        {view === 'expenses' && (
          <ExpensesView canEdit={canEdit} />
        )}

        {view === 'employee_salary' && (
          <EmployeeSalaryView canEdit={canEdit} />
        )}

        {/* --- ACTIVITY LOG --- */}
        {view === 'activity_log' && isAdmin && (
          <ActivityLogView
            filterUserId={activityFilterUserId}
            onFilterChange={setActivityFilterUserId}
          />
        )}

        {/* --- MANAGE USERS --- */}
        {view === 'manage_users' && isAdmin && (
          <ManageUsersView />
        )}

        </main>
      </div>

      {/* Modals */}
      <AddItemModal 
        isOpen={isAddModalOpen} 
        onClose={() => { setIsAddModalOpen(false); setItemToEdit(undefined); }} 
        onSave={handleSaveItem}
        onDelete={itemToEdit ? deleteInventoryItem : undefined}
        editItem={itemToEdit}
        existingItems={items}
      />

      <InventoryImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImported={(importedItems) => {
          setItems(importedItems.map((i) => normalizeItem(i)));
          fetchItemsAndTransactions();
          setIsImportModalOpen(false);
        }}
      />

      <ReleaseModal 
        isOpen={isReleaseModalOpen}
        onClose={() => setIsReleaseModalOpen(false)}
        onConfirm={handleReleaseItem}
        item={itemToRelease}
        items={items}
        persons={persons}
        vehicles={vehicles}
        onPersonCreated={() => personsApi.list().then((res) => setPersons(res.persons ?? []))}
        onVehicleCreated={() => vehiclesApi.list().then((res) => setVehicles(res.vehicles ?? []))}
      />

      <IssueModal 
        isOpen={isIssueModalOpen}
        onClose={() => { setIsIssueModalOpen(false); setItemToIssue(null); }}
        onConfirm={handleIssueItem}
        item={itemToIssue}
        items={items}
      />

      <ReturnModal 
        isOpen={isReturnModalOpen}
        onClose={() => { setIsReturnModalOpen(false); setItemToReturn(null); }}
        onConfirm={handleReturnItem}
        item={itemToReturn}
        items={items}
        transactions={transactions}
      />
      
      <AddStockModal
        isOpen={isAddStockModalOpen}
        onClose={() => setIsAddStockModalOpen(false)}
        onConfirm={handleAddStock}
        item={itemToAddStock}
      />

      <EditAdditionTransactionModal
        isOpen={!!transactionToEditAddition}
        transaction={transactionToEditAddition}
        onClose={() => setTransactionToEditAddition(null)}
        onSave={handlePatchAddition}
      />

      <ReturnFromSalesModal
        isOpen={isReturnFromSalesModalOpen}
        onClose={() => { setIsReturnFromSalesModalOpen(false); setInitialReleaseIdForReturn(null); }}
        onConfirm={handleReturnFromSales}
        transactions={transactions}
        persons={persons}
        vehicles={vehicles}
        initialReleaseId={initialReleaseIdForReturn}
      />

      <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />

      {billingStatementPrintTx && (
        <BillingStatementPrintModal
          transaction={billingStatementPrintTx}
          onClose={() => setBillingStatementPrintTx(null)}
        />
      )}

      <DocumentPrintPreviewModal docs={printPreviewDocs} onClose={() => setPrintPreviewDocs(null)} />
    </div>
  );
};

export default App;