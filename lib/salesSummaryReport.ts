import type { Expense, InventoryItem, Person, Transaction, Vehicle } from '../types';
import { itemCapitalPerUnit } from './inventoryPricing';

function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/** Calendar date in local timezone (for labels and expense string compare). */
export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function parseLocalDayStart(ymd: string): Date {
  const [y, mo, day] = ymd.split('-').map(Number);
  if (!y || !mo || !day) return new Date(NaN);
  return new Date(y, mo - 1, day, 0, 0, 0, 0);
}

export function endOfLocalDay(ymd: string): Date {
  const [y, mo, day] = ymd.split('-').map(Number);
  if (!y || !mo || !day) return new Date(NaN);
  return new Date(y, mo - 1, day, 23, 59, 59, 999);
}

/** Pre-discount selling amount for one RELEASE (matches “Total Sales” / revenue basis in sales summaries). */
export function releaseGrossSellingAmount(t: Transaction): number {
  if (t.subtotalBeforeDiscount != null && Number(t.subtotalBeforeDiscount) > 0) {
    return round2(Number(t.subtotalBeforeDiscount));
  }
  if (t.posLineItems && t.posLineItems.length > 0) {
    return round2(
      t.posLineItems.reduce((s, line) => {
        const lineSub = Number(line.lineSubtotal ?? line.quantity * line.unitPrice);
        return s + (Number.isFinite(lineSub) ? lineSub : 0);
      }, 0)
    );
  }
  const tv = Number(t.totalValue || 0);
  if (t.discountAmount != null && Number(t.discountAmount) > 0) {
    return round2(tv + Number(t.discountAmount));
  }
  if (t.discountPercent != null && Number(t.discountPercent) > 0) {
    const pct = Math.min(99.99, Math.max(0, Number(t.discountPercent)));
    if (pct > 0 && pct < 100) return round2(tv / (1 - pct / 100));
  }
  return round2(tv);
}

/** Transaction-level discount in pesos (percent, fixed, or implied from gross − total). */
export function releaseDiscountAmount(t: Transaction): number {
  const sub = releaseGrossSellingAmount(t);
  if (sub <= 0) return 0;
  if (t.discountAmount != null && Number(t.discountAmount) > 0) {
    return round2(Math.min(sub, Number(t.discountAmount)));
  }
  if (t.discountPercent != null && Number(t.discountPercent) > 0) {
    const pct = Math.min(100, Math.max(0, Number(t.discountPercent)));
    return round2(sub * (pct / 100));
  }
  if (t.posLineItems && t.posLineItems.length > 0) {
    let lineDisc = 0;
    for (const li of t.posLineItems) {
      const dpu = Number(li.discountPerUnit ?? 0);
      if (dpu > 0) lineDisc += round2(dpu * (Number(li.quantity) || 0));
    }
    if (lineDisc > 0.005) return round2(Math.min(sub, lineDisc));
  }
  return round2(Math.max(0, sub - Number(t.totalValue || 0)));
}

/** COGS for one RELEASE (stored on new POS rows, or estimated from inventory for legacy). Uses capital (cost) per unit × qty; capital defaults to retail only when missing so implied margin is zero. */
export function releaseCogs(t: Transaction, items: InventoryItem[]): number {
  if (t.totalCostAtTime != null && Number.isFinite(Number(t.totalCostAtTime)) && Number(t.totalCostAtTime) >= 0) {
    return round2(Number(t.totalCostAtTime));
  }
  if (t.posLineItems && t.posLineItems.length > 0) {
    return round2(
      t.posLineItems.reduce((s, line) => {
        if (line.itemType !== 'Product') return s;
        let cpu = line.costPerUnit != null && Number.isFinite(Number(line.costPerUnit)) ? Number(line.costPerUnit) : NaN;
        if (!Number.isFinite(cpu) && line.itemId) {
          const inv = items.find((i) => i.id === line.itemId);
          cpu = inv ? itemCapitalPerUnit(inv) : NaN;
        }
        return s + line.quantity * (Number.isFinite(cpu) ? cpu : 0);
      }, 0)
    );
  }
  if (t.itemType === 'Product' && t.itemId) {
    const inv = items.find((i) => i.id === t.itemId);
    const cpu = inv ? itemCapitalPerUnit(inv) : 0;
    const q = Math.abs(Number(t.quantityChange || 0));
    return round2(q * cpu);
  }
  return 0;
}

export function releaseSplitGoodsServiceGross(t: Transaction): { goods: number; service: number } {
  if (t.posLineItems && t.posLineItems.length > 0) {
    let goods = 0;
    let service = 0;
    for (const line of t.posLineItems) {
      const lineSub = round2(Number(line.lineSubtotal ?? line.quantity * line.unitPrice));
      if (line.itemType === 'Service') service += lineSub;
      else goods += lineSub;
    }
    return { goods: round2(goods), service: round2(service) };
  }
  const sub = releaseGrossSellingAmount(t);
  if (t.itemType === 'Service') return { goods: 0, service: sub };
  return { goods: sub, service: 0 };
}

export function transactionPaymentBucket(t: Transaction): 'cash' | 'onAccount' {
  const m = String(t.modeOfPayment || 'Cash').trim().toLowerCase();
  if (m === 'cash') return 'cash';
  return 'onAccount';
}

export interface MotorWorldSalesSummary {
  periodLabel: string;
  startDate: string;
  endDate: string;
  salesOfGoods: number;
  salesOfServiceAndLabor: number;
  totalNetOfGoodsAndServicesSold: number;
  cashSales: number;
  accountsReceivableAndSimilar: number;
  costOfGoodsAndServices: number;
  totalDiscounts: number;
  /** Total gross sales in the document = gross profit before operating expenses. */
  totalGrossSales: number;
  totalOperatingExpenses: number;
  netIncome: number;
  releaseCount: number;
}

/**
 * P&amp;L flow aligned with common sales summary practice (see Motor World–style reports):
 * 1) Revenue: goods + service = total net of goods &amp; services sold (pre-discount selling).
 * 2) Less: COGS, less: discounts → total gross sales (gross profit).
 * 3) Less: operating expenses → net income.
 */
export function computeMotorWorldSalesSummary(
  transactions: Transaction[],
  expenses: Expense[],
  items: InventoryItem[],
  start: Date,
  end: Date
): MotorWorldSalesSummary {
  const startMs = start.getTime();
  const endMs = end.getTime();

  const inRange = (t: Transaction) => {
    const ts = new Date(t.timestamp).getTime();
    return ts >= startMs && ts <= endMs;
  };

  const releases = transactions.filter((t) => t.type === 'RELEASE' && inRange(t));

  let salesOfGoods = 0;
  let salesOfServiceAndLabor = 0;
  let cashSales = 0;
  let accountsReceivableAndSimilar = 0;
  let costOfGoodsAndServices = 0;
  let totalDiscounts = 0;

  for (const t of releases) {
    const gross = releaseGrossSellingAmount(t);
    const split = releaseSplitGoodsServiceGross(t);
    salesOfGoods += split.goods;
    salesOfServiceAndLabor += split.service;

    const bucket = transactionPaymentBucket(t);
    if (bucket === 'cash') cashSales += gross;
    else accountsReceivableAndSimilar += gross;

    costOfGoodsAndServices += releaseCogs(t, items);
    totalDiscounts += releaseDiscountAmount(t);
  }

  salesOfGoods = round2(salesOfGoods);
  salesOfServiceAndLabor = round2(salesOfServiceAndLabor);
  const totalNetOfGoodsAndServicesSold = round2(salesOfGoods + salesOfServiceAndLabor);
  cashSales = round2(cashSales);
  accountsReceivableAndSimilar = round2(accountsReceivableAndSimilar);
  costOfGoodsAndServices = round2(costOfGoodsAndServices);
  totalDiscounts = round2(totalDiscounts);

  const totalGrossSales = round2(totalNetOfGoodsAndServicesSold - costOfGoodsAndServices - totalDiscounts);

  const expenseRows = expenses.filter((e) => {
    const d = new Date(e.date).getTime();
    return d >= startMs && d <= endMs;
  });
  const totalOperatingExpenses = round2(expenseRows.reduce((s, e) => s + Number(e.amount || 0), 0));

  const netIncome = round2(totalGrossSales - totalOperatingExpenses);

  return {
    periodLabel: `${toLocalYmd(start)} – ${toLocalYmd(end)}`,
    startDate: toLocalYmd(start),
    endDate: toLocalYmd(end),
    salesOfGoods,
    salesOfServiceAndLabor,
    totalNetOfGoodsAndServicesSold,
    cashSales,
    accountsReceivableAndSimilar,
    costOfGoodsAndServices,
    totalDiscounts,
    totalGrossSales,
    totalOperatingExpenses,
    netIncome,
    releaseCount: releases.length,
  };
}

/** One RELEASE in the report window (for detailed / printable breakdown). */
export interface SalesSummaryReleaseDetailRow {
  id: string;
  timestamp: string;
  recipient: string;
  itemSummary: string;
  modeOfPayment: string;
  paymentBucket: 'cash' | 'onAccount';
  grossSelling: number;
  cogs: number;
  discount: number;
  /** Gross selling − COGS − discount (line contribution to gross profit). */
  lineNet: number;
}

export function buildSalesSummaryReleaseDetails(
  transactions: Transaction[],
  items: InventoryItem[],
  start: Date,
  end: Date
): SalesSummaryReleaseDetailRow[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const inRange = (t: Transaction) => {
    const ts = new Date(t.timestamp).getTime();
    return ts >= startMs && ts <= endMs;
  };
  const releases = transactions.filter((t) => t.type === 'RELEASE' && inRange(t));
  return releases
    .map((t) => {
      const gross = releaseGrossSellingAmount(t);
      const cogs = releaseCogs(t, items);
      const discount = releaseDiscountAmount(t);
      const lineNet = round2(gross - cogs - discount);
      return {
        id: t.id,
        timestamp: t.timestamp,
        recipient: t.recipient || '—',
        itemSummary: (t.itemName || '—').slice(0, 200),
        modeOfPayment: String(t.modeOfPayment || 'Cash').trim(),
        paymentBucket: transactionPaymentBucket(t),
        grossSelling: gross,
        cogs,
        discount,
        lineNet,
      };
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/** Motor World–style “sales deposit” row for printable sales summary. */
export interface SalesDepositReportRow {
  id: string;
  saleDate: string;
  customerName: string;
  saleReference: string;
  materials: number;
  services: number;
  taxWithheld: number;
  discount: number;
  totalAmount: number;
  dateDepositedLabel: string;
  cashCardDeposited: number;
  checkDeposited: number;
  variance: number;
}

export function saleReferenceForReport(t: Transaction): string {
  const rn = t.receiptNumber?.trim();
  if (rn) return rn;
  return `TX-${(t.id || '').slice(0, 8).toUpperCase()}`;
}

export function buildSalesDepositReportRows(transactions: Transaction[], start: Date, end: Date): SalesDepositReportRow[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const inRange = (t: Transaction) => {
    const ts = new Date(t.timestamp).getTime();
    return ts >= startMs && ts <= endMs;
  };
  const releases = transactions.filter((t) => t.type === 'RELEASE' && inRange(t));
  return releases
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((t) => {
      const { goods: materials, service: services } = releaseSplitGoodsServiceGross(t);
      const discount = releaseDiscountAmount(t);
      const totalAmount = round2(Number(t.totalValue || 0));
      const mode = String(t.modeOfPayment || 'Cash').trim().toLowerCase();

      let dateDepositedLabel = '—';
      let cashCardDeposited = 0;
      let checkDeposited = 0;

      if (mode === 'cash') {
        dateDepositedLabel = new Date(t.timestamp).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        cashCardDeposited = totalAmount;
      } else if (mode === 'cheque') {
        if (t.chequeStatus === 'cleared' && t.chequeClearedAt) {
          dateDepositedLabel = new Date(t.chequeClearedAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          cashCardDeposited = totalAmount;
          checkDeposited = 0;
        } else if (t.chequeStatus === 'bounced') {
          dateDepositedLabel = 'Cheque bounced';
          cashCardDeposited = 0;
          checkDeposited = 0;
        } else {
          dateDepositedLabel = 'Pending clearance';
          cashCardDeposited = 0;
          checkDeposited = totalAmount;
        }
      } else {
        dateDepositedLabel = 'On account';
      }

      const variance = round2(totalAmount - cashCardDeposited - checkDeposited);

      return {
        id: t.id,
        saleDate: new Date(t.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
        customerName: String(t.recipient || '—').trim() || '—',
        saleReference: saleReferenceForReport(t),
        materials: round2(materials),
        services: round2(services),
        taxWithheld: 0,
        discount: round2(discount),
        totalAmount,
        dateDepositedLabel,
        cashCardDeposited: round2(cashCardDeposited),
        checkDeposited: round2(checkDeposited),
        variance,
      };
    });
}

/** Semi-month bucket label used on Motor World SR-1 sales register (e.g. JANUARY 1-15, 2026). */
export function semiMonthCoveredLabel(d: Date): string {
  const month = d.toLocaleString('en-US', { month: 'long' }).toUpperCase();
  const year = d.getFullYear();
  const day = d.getDate();
  if (day <= 15) return `${month} 1-15, ${year}`;
  const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
  return `${month} 16-${lastDay}, ${year}`;
}

function sr1TransactionTypeLabel(t: Transaction): string {
  const mode = String(t.modeOfPayment || 'Cash').trim();
  if (mode === 'Credit') return 'A/R';
  if (mode === 'Purchase Order') return 'P.O.';
  if (mode === 'Cheque') return 'CHEQUE';
  return 'CASH';
}

function sr1InvoiceLabel(t: Transaction): string {
  const inv = String(t.invoiceNumber || t.receiptNumber || '').trim();
  const type = sr1TransactionTypeLabel(t);
  return inv ? `${inv} (${type})` : type;
}

function padCrNo(n: number): string {
  return String(n).padStart(3, '0');
}

function vehicleCarModel(vehicle: Vehicle | undefined): string {
  if (!vehicle) return '—';
  const brand = String(vehicle.brand || '').trim();
  const model = String(vehicle.model || '').trim();
  if (brand && model) return `${brand}/${model}`;
  return brand || model || '—';
}

/** One line on the SR-1 sales register (matches Motor World SR-1.pdf column layout). */
export interface SalesRegisterLineRow {
  transactionId: string;
  saleDate: string;
  dateCovered: string;
  crNo: string;
  bsNo: string;
  poNo: string;
  invoiceLabel: string;
  transactionType: string;
  customerName: string;
  address: string;
  carModel: string;
  plateNo: string;
  terms: string;
  supplierName: string;
  itemCode: string;
  description: string;
  qty: number;
  uom: string;
  costPerUnit: number;
  totalCost: number;
  unitPrice: number;
  totalPrice: number;
  transactionTotal: number;
  discountPeso: number;
  discountPercent: number;
}

export function buildSalesRegisterLines(
  transactions: Transaction[],
  items: InventoryItem[],
  persons: Person[],
  vehicles: Vehicle[],
  start: Date,
  end: Date
): SalesRegisterLineRow[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const inRange = (t: Transaction) => {
    const ts = new Date(t.timestamp).getTime();
    return ts >= startMs && ts <= endMs;
  };
  const releases = transactions
    .filter((t) => t.type === 'RELEASE' && inRange(t))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const personById = new Map(persons.map((p) => [p.id, p]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const rows: SalesRegisterLineRow[] = [];

  releases.forEach((t, crIndex) => {
    const saleDateObj = new Date(t.timestamp);
    const saleDate = saleDateObj.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const dateCovered = semiMonthCoveredLabel(saleDateObj);
    const crNo = padCrNo(crIndex + 1);
    const bsNo = String(t.receiptNumber || saleReferenceForReport(t)).trim() || '—';
    const poNo =
      String(t.modeOfPayment || '').trim() === 'Purchase Order' && t.invoiceNumber
        ? String(t.invoiceNumber).trim()
        : '—';
    const invoiceLabel = sr1InvoiceLabel(t);
    const transactionType = sr1TransactionTypeLabel(t);
    const person = t.personId ? personById.get(t.personId) : undefined;
    const vehicle = t.vehicleId ? vehicleById.get(t.vehicleId) : undefined;
    const customerName = String(t.recipient || person?.fullName || '—').trim() || '—';
    const address = String(person?.address || '—').trim() || '—';
    const carModel = vehicleCarModel(vehicle);
    const plateNo = String(vehicle?.plateNumber || '—').trim() || '—';
    const terms = String(t.terms || '—').trim() || '—';
    const transactionTotal = round2(Number(t.totalValue || 0));

    const pushLine = (line: {
      supplierName: string;
      itemCode: string;
      description: string;
      qty: number;
      uom: string;
      costPerUnit: number;
      unitPrice: number;
      lineSubtotal: number;
      discountPeso: number;
    }) => {
      const totalCost = round2(line.qty * line.costPerUnit);
      const totalPrice = round2(line.lineSubtotal);
      const discountPercent =
        totalPrice > 0 && line.discountPeso > 0 ? round2((line.discountPeso / totalPrice) * 100) : 0;
      rows.push({
        transactionId: t.id,
        saleDate,
        dateCovered,
        crNo,
        bsNo,
        poNo,
        invoiceLabel,
        transactionType,
        customerName,
        address,
        carModel,
        plateNo,
        terms,
        supplierName: line.supplierName,
        itemCode: line.itemCode,
        description: line.description,
        qty: line.qty,
        uom: line.uom,
        costPerUnit: round2(line.costPerUnit),
        totalCost,
        unitPrice: round2(line.unitPrice),
        totalPrice,
        transactionTotal,
        discountPeso: round2(line.discountPeso),
        discountPercent,
      });
    };

    if (t.posLineItems && t.posLineItems.length > 0) {
      for (const li of t.posLineItems) {
        const inv = li.itemId ? itemById.get(li.itemId) : undefined;
        const qty = Math.abs(Number(li.quantity) || 0);
        const unitPrice = Number(li.unitPrice) || 0;
        const lineSubtotal = round2(Number(li.lineSubtotal ?? qty * unitPrice));
        let costPerUnit = li.costPerUnit != null && Number.isFinite(Number(li.costPerUnit)) ? Number(li.costPerUnit) : NaN;
        if (!Number.isFinite(costPerUnit) && inv) costPerUnit = itemCapitalPerUnit(inv);
        if (!Number.isFinite(costPerUnit)) costPerUnit = 0;
        const dpu = Number(li.discountPerUnit ?? 0);
        const discountPeso = dpu > 0 ? round2(dpu * qty) : 0;
        pushLine({
          supplierName: String(inv?.brand || '—').trim() || '—',
          itemCode: String(inv?.itemCode || '—').trim() || '—',
          description: String(li.itemName || '—').trim() || '—',
          qty,
          uom: li.itemType === 'Service' ? 'lot' : String(inv?.unit || 'PC/S').trim() || 'PC/S',
          costPerUnit,
          unitPrice,
          lineSubtotal,
          discountPeso,
        });
      }
      return;
    }

    const inv = t.itemId ? itemById.get(t.itemId) : undefined;
    const qty = Math.abs(Number(t.quantityChange) || 0) || 1;
    const gross = releaseGrossSellingAmount(t);
    const discountPeso = releaseDiscountAmount(t);
    const unitPrice = qty > 0 ? round2(gross / qty) : round2(Number(t.unitPriceAtTime) || 0);
    let costPerUnit = inv ? itemCapitalPerUnit(inv) : 0;
    if (t.itemType === 'Service') costPerUnit = 0;
    pushLine({
      supplierName: String(inv?.brand || '—').trim() || '—',
      itemCode: String(inv?.itemCode || '—').trim() || '—',
      description: String(t.itemName || '—').trim() || '—',
      qty,
      uom: t.itemType === 'Service' ? 'lot' : String(inv?.unit || 'PC/S').trim() || 'PC/S',
      costPerUnit,
      unitPrice,
      lineSubtotal: gross,
      discountPeso,
    });
  });

  return rows;
}
