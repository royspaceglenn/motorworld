import React, { useState, useEffect, useMemo } from 'react';
import {
  InventoryItem,
  Person,
  Vehicle,
  Transaction,
  normalizeStockPurpose,
  isExcludedFromPosProductPicker,
} from '../types';
import { itemCapitalPerUnit, itemRetailPerUnit } from '../lib/inventoryPricing';
import { personsApi, vehiclesApi, transactionsApi, bookingsApi } from '../lib/api/adminData';
import type { PosBookingTransfer } from '../lib/posBookingTransfer';
import { posPaymentFromBookingMode } from '../lib/posBookingTransfer';
import { buildReceiptHtml } from './ReceiptPrint';
import { openDocumentPreview } from '../lib/documentPreviewBus';
import {
  loadBillingLetterhead,
  saveBillingLetterhead,
  loadBillingPrePrintedFormPreference,
  saveBillingPrePrintedFormPreference,
  loadPrePrintedInvoiceNumber,
  savePrePrintedInvoiceNumber,
  loadPrePrintedCustomerTin,
  savePrePrintedCustomerTin,
  loadPrePrintedCustomerAddress,
  savePrePrintedCustomerAddress,
} from '../lib/billingLetterhead';
import { loadOverlayCalibration } from '../lib/prePrintedReceiptOverlay';
import { PrePrintedOverlayCalibrationPanel } from './PrePrintedOverlayCalibration';
import {
  BILLING_VAT_RATE,
  billingLineRowsFromPosCart,
  buildBillingStatementHtml,
  buildTransactionBillingStatementHtml,
} from '../lib/transactionBillingStatementPrint';
import { dateInputToIsoTimestamp, formatDateInputForDisplay, todayDateInputValue } from '../lib/transactionDate';
import { ShoppingCart, ChevronDown, Banknote, FileText, CreditCard, Plus, Trash2, ScrollText, Printer } from 'lucide-react';

export type POSPaymentType = 'Cash' | 'Purchase Order' | 'Accounts Receivable' | 'Cheque';

interface POSViewProps {
  items: InventoryItem[];
  persons: Person[];
  vehicles: Vehicle[];
  canEdit: boolean;
  onSaleComplete?: () => void;
  bookingTransfer?: PosBookingTransfer | null;
  onBookingTransferCleared?: () => void;
}

type DraftItemType = 'Product' | 'Service';

interface CartLine {
  id: string;
  itemType: DraftItemType;
  itemId: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  /** Per-unit discount (PHP); total line discount = discountPerUnit × qty. */
  discountPerUnit: number;
  /** COGS per unit for migration lines (optional). */
  costPerUnit?: number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function lineGross(line: CartLine) {
  return round2(line.qty * line.unitPrice);
}

function lineDiscountTotal(line: CartLine) {
  return round2((line.discountPerUnit ?? 0) * line.qty);
}

function lineNetSelling(line: CartLine) {
  return round2(lineGross(line) - lineDiscountTotal(line));
}

function qtyInCartForProduct(cart: CartLine[], itemId: string) {
  return cart
    .filter((l) => l.itemType === 'Product' && l.itemId === itemId)
    .reduce((s, l) => s + l.qty, 0);
}

export const POSView: React.FC<POSViewProps> = ({
  items,
  persons,
  vehicles,
  canEdit,
  onSaleComplete,
  bookingTransfer,
  onBookingTransferCleared,
}) => {
  const [customerInput, setCustomerInput] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [vehicleInput, setVehicleInput] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [draftItemType, setDraftItemType] = useState<DraftItemType>('Product');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [draftQty, setDraftQty] = useState(1);
  const [draftPrice, setDraftPrice] = useState(0);
  const [draftDiscountPerUnit, setDraftDiscountPerUnit] = useState(0);
  const [note, setNote] = useState('');
  const [paymentType, setPaymentType] = useState<POSPaymentType>('Cash');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [dueDays, setDueDays] = useState(30);
  const [chequeExpectedClearDate, setChequeExpectedClearDate] = useState('');
  const [chequeReference, setChequeReference] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayDateInputValue);
  const [historicalSale, setHistoricalSale] = useState(false);
  const [migrationProductName, setMigrationProductName] = useState('');
  const [draftCostPerUnit, setDraftCostPerUnit] = useState(0);
  const [isPersonDropdownOpen, setIsPersonDropdownOpen] = useState(false);
  const [isVehicleDropdownOpen, setIsVehicleDropdownOpen] = useState(false);
  const [isItemDropdownOpen, setIsItemDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaleForBilling, setLastSaleForBilling] = useState<Transaction | null>(null);
  const [bhRegisteredName, setBhRegisteredName] = useState('');
  const [bhTin, setBhTin] = useState('');
  const [bhAddress, setBhAddress] = useState('');
  const [bhShowVat, setBhShowVat] = useState(false);
  const [bhPrePrintedForm, setBhPrePrintedForm] = useState(false);
  const [bhInvoiceNumber, setBhInvoiceNumber] = useState('');
  const [bhCustomerTin, setBhCustomerTin] = useState('');
  const [bhCustomerAddress, setBhCustomerAddress] = useState('');
  const [overlayCalibration, setOverlayCalibration] = useState(loadOverlayCalibration);

  const activeDraftItem = items.find((i) => i.id === selectedItemId);
  const vehiclesForPerson = selectedPersonId ? vehicles.filter((v) => v.personId === selectedPersonId) : [];

  const personSuggestions = useMemo(
    () =>
      customerInput.trim()
        ? persons.filter((p) => p.fullName.toLowerCase().includes(customerInput.trim().toLowerCase()))
        : persons,
    [persons, customerInput]
  );
  const vehicleSuggestions = useMemo(
    () =>
      vehicleInput.trim()
        ? vehiclesForPerson.filter(
            (v) =>
              v.plateNumber.toLowerCase().includes(vehicleInput.trim().toLowerCase()) ||
              (v.brand && v.brand.toLowerCase().includes(vehicleInput.trim().toLowerCase()))
          )
        : vehiclesForPerson,
    [vehiclesForPerson, vehicleInput]
  );
  const itemSuggestions = useMemo(
    () =>
      items.filter(
        (i) =>
          (historicalSale || (i.quantity ?? 0) > 0) &&
          normalizeStockPurpose(i.stockPurpose) === 'for_sale' &&
          !isExcludedFromPosProductPicker(i.category)
      ),
    [items, historicalSale]
  );

  useEffect(() => {
    if (activeDraftItem) setDraftPrice(activeDraftItem.unitPrice ?? 0);
  }, [activeDraftItem]);

  useEffect(() => {
    const h = loadBillingLetterhead();
    setBhRegisteredName(h.registeredName);
    setBhTin(h.tin);
    setBhAddress(h.businessAddress);
    setBhPrePrintedForm(loadBillingPrePrintedFormPreference());
    setBhInvoiceNumber(loadPrePrintedInvoiceNumber());
    setBhCustomerTin(loadPrePrintedCustomerTin());
    setBhCustomerAddress(loadPrePrintedCustomerAddress());
    setOverlayCalibration(loadOverlayCalibration());
  }, []);

  useEffect(() => {
    if (!bookingTransfer) return;
    const transfer = bookingTransfer;
    setCustomerInput(transfer.fullName);
    if (transfer.personId) setSelectedPersonId(transfer.personId);
    if (transfer.vehicleId) {
      setSelectedVehicleId(transfer.vehicleId);
      const vehicle = vehicles.find((v) => v.id === transfer.vehicleId);
      if (vehicle) setVehicleInput(vehicle.plateNumber);
    } else {
      setSelectedVehicleId('');
      setVehicleInput('');
    }
    const price = Math.max(0, Number(transfer.quotedAmount ?? 0));
    setCart([
      {
        id: crypto.randomUUID(),
        itemType: 'Service',
        itemId: null,
        name: transfer.serviceLabel,
        qty: 1,
        unitPrice: price,
        discountPerUnit: 0,
      },
    ]);
    setDraftItemType('Service');
    setServiceName('');
    setDraftQty(1);
    setDraftPrice(price);
    setPaymentType(posPaymentFromBookingMode(transfer.modeOfPayment));
    if (transfer.dueDays != null && transfer.dueDays > 0) {
      setDueDays(transfer.dueDays);
    }
    const noteParts = [
      `Online booking #${transfer.bookingId.slice(0, 8)}`,
      transfer.bookingNotes?.trim(),
      transfer.confirmNote?.trim(),
    ].filter(Boolean);
    setNote(noteParts.join(' · '));
    if (transfer.preferredDate && /^\d{4}-\d{2}-\d{2}/.test(transfer.preferredDate)) {
      setTransactionDate(transfer.preferredDate.slice(0, 10));
    }
    setError(null);
  }, [bookingTransfer, vehicles]);

  const subtotal = useMemo(() => round2(cart.reduce((s, l) => s + lineGross(l), 0)), [cart]);

  const totalLineDiscount = useMemo(() => round2(cart.reduce((s, l) => s + lineDiscountTotal(l), 0)), [cart]);

  const grandTotal = useMemo(() => round2(subtotal - totalLineDiscount), [subtotal, totalLineDiscount]);

  const totalCost = useMemo(
    () =>
      round2(
        cart.reduce((s, line) => {
          if (line.itemType !== 'Product') return s;
          if (line.costPerUnit != null && line.costPerUnit > 0) {
            return s + line.qty * line.costPerUnit;
          }
          if (!line.itemId) return s;
          const inv = items.find((i) => i.id === line.itemId);
          const cap = inv ? itemCapitalPerUnit(inv) : 0;
          return s + line.qty * cap;
        }, 0)
      ),
    [cart, items]
  );

  const netIncome = useMemo(() => round2(grandTotal - totalCost), [grandTotal, totalCost]);

  const resolvePersonId = (): Promise<string | null> => {
    if (selectedPersonId) return Promise.resolve(selectedPersonId);
    const name = customerInput.trim();
    if (!name) return Promise.resolve(null);
    const found = persons.find((p) => p.fullName.trim().toLowerCase() === name.toLowerCase());
    if (found) return Promise.resolve(found.id);
    return personsApi
      .create({ fullName: name, contactNumber: '' })
      .then((saved) => {
        onSaleComplete?.();
        return saved.id;
      })
      .catch(() => null);
  };

  const resolveVehicleId = (personId: string): Promise<string | undefined> => {
    if (selectedVehicleId) {
      const v = vehicles.find((x) => x.id === selectedVehicleId && x.personId === personId);
      if (v) return Promise.resolve(v.id);
    }
    const plate = vehicleInput.trim();
    if (!plate) return Promise.resolve(undefined);
    const forPerson = vehicles.filter((v) => v.personId === personId);
    const found = forPerson.find((v) => v.plateNumber.trim().toLowerCase() === plate.toLowerCase());
    if (found) return Promise.resolve(found.id);
    return vehiclesApi
      .create({ personId, plateNumber: plate })
      .then((saved) => {
        onSaleComplete?.();
        return saved.id;
      })
      .catch((err) => {
        throw new Error(err instanceof Error ? err.message : 'Could not save vehicle.');
      });
  };

  const addDraftToCart = () => {
    setError(null);
    const price = Math.max(0, round2(draftPrice));
    let dpu = round2(Number(draftDiscountPerUnit) || 0);
    if (!Number.isFinite(dpu) || dpu < 0) dpu = 0;
    if (dpu > price + 0.0001) {
      setError('Discount per unit cannot exceed unit price.');
      return;
    }

    if (draftItemType === 'Product') {
      if (cart.some((l) => l.itemType === 'Service')) {
        setError('This cart already has a service. Remove it or complete the sale before adding a product.');
        return;
      }
      const q = Math.max(1, Math.floor(draftQty));
      const lineCost = round2(Number(draftCostPerUnit) || 0);

      if (historicalSale) {
        const name = migrationProductName.trim() || activeDraftItem?.name?.trim() || '';
        if (!name) {
          setError('Enter the product name sold (it does not need to be in inventory).');
          return;
        }
        const itemId = activeDraftItem?.id ?? null;
        const costPerUnit =
          lineCost > 0 ? lineCost : activeDraftItem ? round2(itemCapitalPerUnit(activeDraftItem)) : undefined;
        const lineKey = `${name.toLowerCase()}::${itemId ?? ''}`;
        const existingIdx = cart.findIndex(
          (l) =>
            l.itemType === 'Product' &&
            `${l.name.trim().toLowerCase()}::${l.itemId ?? ''}` === lineKey
        );
        if (existingIdx >= 0) {
          setCart((prev) =>
            prev.map((l, i) =>
              i === existingIdx
                ? { ...l, qty: l.qty + q, unitPrice: price, discountPerUnit: dpu, costPerUnit }
                : l
            )
          );
        } else {
          setCart((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              itemType: 'Product',
              itemId,
              name,
              qty: q,
              unitPrice: price,
              discountPerUnit: dpu,
              costPerUnit,
            },
          ]);
        }
        setMigrationProductName('');
        setSelectedItemId('');
        setDraftCostPerUnit(0);
      } else {
        if (!activeDraftItem) {
          setError('Select a product.');
          return;
        }
        const existingIdx = cart.findIndex((l) => l.itemType === 'Product' && l.itemId === activeDraftItem.id);
        const existingQty = existingIdx >= 0 ? cart[existingIdx]!.qty : 0;
        const nextQty = existingQty + q;
        const stock = Number(activeDraftItem.quantity ?? 0);
        if (nextQty > stock) {
          setError(
            `Not enough stock for ${activeDraftItem.name}. In cart: ${existingQty}. You can add at most ${Math.max(0, stock - existingQty)} more.`
          );
          return;
        }
        if (existingIdx >= 0) {
          setCart((prev) =>
            prev.map((l, i) =>
              i === existingIdx ? { ...l, qty: nextQty, unitPrice: price, discountPerUnit: dpu } : l
            )
          );
        } else {
          setCart((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              itemType: 'Product',
              itemId: activeDraftItem.id,
              name: activeDraftItem.name,
              qty: q,
              unitPrice: price,
              discountPerUnit: dpu,
            },
          ]);
        }
      }
      setDraftQty(1);
      setDraftDiscountPerUnit(0);
    } else {
      const name = serviceName.trim();
      if (!name) {
        setError('Enter a service name.');
        return;
      }
      if (cart.some((l) => l.itemType === 'Product')) {
        setError('This cart already has a product. Remove it or complete the sale before adding a service.');
        return;
      }
      if (
        cart.length > 0 &&
        !cart.some((l) => l.itemType === 'Service' && l.name.trim().toLowerCase() === name.toLowerCase())
      ) {
        setError('Only one service per sale. Clear the cart or use the same service name to add quantity.');
        return;
      }
      const q = Math.max(1, Math.floor(draftQty));
      const existingIdx = cart.findIndex(
        (l) => l.itemType === 'Service' && l.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (existingIdx >= 0) {
        const nextQty = cart[existingIdx]!.qty + q;
        setCart((prev) =>
          prev.map((l, i) =>
            i === existingIdx ? { ...l, qty: nextQty, unitPrice: price, discountPerUnit: dpu, name } : l
          )
        );
      } else {
        setCart((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            itemType: 'Service',
            itemId: null,
            name,
            qty: q,
            unitPrice: price,
            discountPerUnit: dpu,
          },
        ]);
      }
      setServiceName('');
      setDraftQty(1);
      setDraftDiscountPerUnit(0);
    }
  };

  const removeCartLine = (id: string) => {
    setCart((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    const hasCustomer = selectedPersonId || customerInput.trim();
    if (!hasCustomer) {
      setError('Select or enter customer name.');
      return;
    }
    if (cart.length === 0) {
      setError('Add at least one line item.');
      return;
    }
    if (grandTotal <= 0) {
      setError('Total after line discounts must be greater than zero.');
      return;
    }
    if (paymentType === 'Purchase Order' && (!invoiceNumber.trim() || !dueDate.trim() || !terms.trim())) {
      setError('Invoice number, due date, and terms are required for Purchase Order.');
      return;
    }
    if (paymentType === 'Cheque' && !chequeExpectedClearDate.trim()) {
      setError('Expected bank clearance date is required for Cheque sales.');
      return;
    }
    if (!transactionDate.trim()) {
      setError('Transaction date is required.');
      return;
    }

    setSubmitting(true);
    resolvePersonId()
      .then((personId) => {
        if (!personId) {
          setError('Could not resolve customer.');
          setSubmitting(false);
          return;
        }
        return resolveVehicleId(personId).then((vehicleId) => ({ personId, vehicleId }));
      })
      .then((ids) => {
        if (!ids) return;
        const { personId, vehicleId } = ids;
        const recipientName = persons.find((p) => p.id === personId)?.fullName || customerInput.trim();
        const modeOfPayment =
          paymentType === 'Cash'
            ? 'Cash'
            : paymentType === 'Purchase Order'
              ? 'Purchase Order'
              : paymentType === 'Cheque'
                ? 'Cheque'
                : 'Credit';
        const saleTimestamp = dateInputToIsoTimestamp(transactionDate);
        const posLineItems = cart.map((l) => {
          const inv = l.itemType === 'Product' && l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
          const dpu = round2(l.discountPerUnit ?? 0);
          let cpu: number | null = null;
          if (l.itemType === 'Product') {
            if (l.costPerUnit != null && l.costPerUnit > 0) cpu = round2(l.costPerUnit);
            else if (inv) cpu = round2(itemCapitalPerUnit(inv));
          }
          return {
            itemId: l.itemType === 'Product' ? l.itemId : null,
            itemName: l.name,
            itemType: l.itemType,
            quantity: l.qty,
            unitPrice: l.unitPrice,
            lineSubtotal: round2(l.qty * l.unitPrice),
            discountPerUnit: dpu > 0 ? dpu : null,
            costPerUnit: cpu,
          };
        });
        const totalUnits = cart.reduce((s, l) => s + l.qty, 0);
        const payload: Parameters<typeof transactionsApi.create>[0] = {
          id: crypto.randomUUID(),
          itemId:
            cart.length === 1 && cart[0]!.itemType === 'Product' && cart[0]!.itemId
              ? cart[0]!.itemId!
              : undefined,
          itemName: cart.map((c) => c.name).join(', ').slice(0, 200),
          type: 'RELEASE',
          quantityChange: -totalUnits,
          unitPriceAtTime: totalUnits > 0 ? round2(grandTotal / totalUnits) : 0,
          totalValue: grandTotal,
          timestamp: saleTimestamp,
          transactionDate: saleTimestamp,
          recipient: recipientName,
          note:
            [note.trim(), historicalSale ? 'Historical sale (migration from manual records)' : '']
              .filter(Boolean)
              .join(' · ') || undefined,
          modeOfPayment,
          personId,
          vehicleId,
          itemType: cart.some((c) => c.itemType === 'Product') ? 'Product' : 'Service',
          posLineItems,
          subtotalBeforeDiscount: subtotal,
          totalCostAtTime: totalCost,
          netIncome,
          bundledSale: cart.length > 1,
          historicalSale: historicalSale || undefined,
        };
        if (totalLineDiscount > 0) {
          payload.discountAmount = totalLineDiscount;
        }
        if (paymentType === 'Purchase Order') {
          payload.invoiceNumber = invoiceNumber.trim();
          payload.dueDate = dueDate.trim();
          payload.terms = terms.trim();
        }
        if (paymentType === 'Accounts Receivable') {
          payload.dueDays = dueDays;
        }
        if (paymentType === 'Cheque') {
          payload.chequeExpectedClearDate = chequeExpectedClearDate.trim();
          if (chequeReference.trim()) payload.chequeReference = chequeReference.trim();
        }
        return transactionsApi.create(payload).then((tx) => ({ tx, personId, recipientName }));
      })
      .then(async (result) => {
        if (!result) return;
        const { tx } = result;
        const transaction = tx as Transaction;
        if (bookingTransfer?.bookingId) {
          try {
            await bookingsApi.completePos(bookingTransfer.bookingId, transaction.id);
          } catch (linkErr) {
            setError(
              linkErr instanceof Error
                ? linkErr.message
                : 'Sale posted but could not link to the online booking.'
            );
            setSubmitting(false);
            return;
          }
          onBookingTransferCleared?.();
        }
        onSaleComplete?.();
        saveBillingLetterhead(billingLetterhead);
        savePrePrintedInvoiceNumber(bhInvoiceNumber);
        savePrePrintedCustomerTin(bhCustomerTin);
        savePrePrintedCustomerAddress(bhCustomerAddress);
        const billingHtml = buildTransactionBillingStatementHtml(
          transaction,
          billingLetterhead,
          billingPrintOptions,
          billingOverlayExtras
        );
        const receiptDoc = {
          html: buildReceiptHtml(transaction),
          title: 'POS receipt (preview)',
          filename: `pos-receipt-${transaction.id.slice(0, 8)}.pdf`,
        };
        const billingDoc = {
          html: billingHtml,
          title: 'Billing statement (preview)',
          filename: `billing-${transaction.id.slice(0, 8)}.pdf`,
        };
        if (transaction.modeOfPayment === 'Cash') {
          openDocumentPreview([receiptDoc, billingDoc]);
        } else {
          openDocumentPreview([billingDoc]);
        }
        setLastSaleForBilling(transaction);
        setCustomerInput('');
        setSelectedPersonId('');
        setSelectedVehicleId('');
        setVehicleInput('');
        setCart([]);
        setSelectedItemId('');
        setServiceName('');
        setDraftQty(1);
        setDraftPrice(0);
        setDraftDiscountPerUnit(0);
        setNote('');
        setInvoiceNumber('');
        setDueDate('');
        setTerms('');
        setChequeExpectedClearDate('');
        setChequeReference('');
        setTransactionDate(todayDateInputValue());
        setHistoricalSale(false);
        setMigrationProductName('');
        setDraftCostPerUnit(0);
      })
      .catch((err) => {
        setError(err?.message ?? 'Sale failed.');
      })
      .finally(() => setSubmitting(false));
  };

  const canSubmit =
    canEdit &&
    cart.length > 0 &&
    grandTotal > 0 &&
    (selectedPersonId || customerInput.trim()) &&
    (paymentType !== 'Purchase Order' || (invoiceNumber.trim() && dueDate.trim() && terms.trim())) &&
    (paymentType !== 'Cheque' || chequeExpectedClearDate.trim()) &&
    transactionDate.trim();

  const billingLetterhead = useMemo(
    () => ({
      registeredName: bhRegisteredName,
      tin: bhTin,
      businessAddress: bhAddress,
    }),
    [bhRegisteredName, bhTin, bhAddress]
  );

  const billingPrintOptions = useMemo(
    () => ({
      showVatBreakdown: bhShowVat,
      vatRatePercent: BILLING_VAT_RATE,
      prePrintedForm: bhPrePrintedForm,
      overlayCalibration,
    }),
    [bhShowVat, bhPrePrintedForm, overlayCalibration]
  );

  const billingOverlayExtras = useMemo(
    () => ({
      invoiceNumber: bhInvoiceNumber.trim() || undefined,
      customerTin: bhCustomerTin.trim() || undefined,
      customerAddress: bhCustomerAddress.trim() || undefined,
    }),
    [bhInvoiceNumber, bhCustomerTin, bhCustomerAddress]
  );

  const isChargeSaleForPrint =
    paymentType === 'Accounts Receivable' ||
    paymentType === 'Purchase Order' ||
    paymentType === 'Cheque';

  const printPosBillingFromCart = () => {
    setError(null);
    if (cart.length === 0) {
      setError('Add cart lines before printing a billing statement.');
      return;
    }
    if (grandTotal <= 0) {
      setError('Total amount due must be greater than zero.');
      return;
    }
    saveBillingLetterhead(billingLetterhead);
    savePrePrintedInvoiceNumber(bhInvoiceNumber);
    savePrePrintedCustomerTin(bhCustomerTin);
    savePrePrintedCustomerAddress(bhCustomerAddress);
    const lineRows = billingLineRowsFromPosCart(
      cart.map((l) => ({
        name: l.name,
        itemType: l.itemType,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discountPerUnit: l.discountPerUnit > 0 ? l.discountPerUnit : undefined,
      }))
    );
    const customerLabel = selectedPersonId
      ? persons.find((p) => p.id === selectedPersonId)?.fullName?.trim()
      : customerInput.trim();
    const refPart = customerLabel ? `POS draft · ${customerLabel}` : 'POS cart draft (not posted)';
    const html = buildBillingStatementHtml(
      {
        lineRows,
        totalDue: grandTotal,
        footerRef: refPart,
        footerDate: formatDateInputForDisplay(transactionDate),
        customerName: customerLabel || undefined,
        customerTin: billingOverlayExtras.customerTin,
        customerAddress: billingOverlayExtras.customerAddress,
        invoiceNumber: billingOverlayExtras.invoiceNumber,
        isChargeSale: isChargeSaleForPrint,
        documentDate: formatDateInputForDisplay(transactionDate),
      },
      billingLetterhead,
      billingPrintOptions
    );
    openDocumentPreview({
      html,
      title: 'Billing statement (draft preview)',
      filename: 'pos-billing-draft.pdf',
    });
  };

  const printPosBillingLastSale = () => {
    if (!lastSaleForBilling) return;
    saveBillingLetterhead(billingLetterhead);
    savePrePrintedInvoiceNumber(bhInvoiceNumber);
    savePrePrintedCustomerTin(bhCustomerTin);
    savePrePrintedCustomerAddress(bhCustomerAddress);
    const html = buildTransactionBillingStatementHtml(
      lastSaleForBilling,
      billingLetterhead,
      billingPrintOptions,
      billingOverlayExtras
    );
    openDocumentPreview({
      html,
      title: 'Billing statement (preview)',
      filename: `billing-${lastSaleForBilling.id.slice(0, 8)}.pdf`,
    });
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto space-y-4">
      {bookingTransfer && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          <p className="font-semibold">Online booking checkout</p>
          <p className="mt-0.5 text-indigo-800">
            {bookingTransfer.fullName} — {bookingTransfer.serviceLabel}. Review items, payment, and billing, then complete
            the sale to finish this booking.
          </p>
          {onBookingTransferCleared && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
              onClick={onBookingTransferCleared}
            >
              Clear booking prefill
            </button>
          )}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-indigo-50">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <ShoppingCart className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Point of Sale</h3>
              <p className="text-sm text-slate-500">
                Add multiple product lines per receipt (each with its own quantity, price, and per-unit discount), or one
                service line (quantity can be more than one). Products and services cannot be mixed in the same cart.
                Total line discount = discount per unit × quantity. COGS and gross profit use inventory capital price on
                product lines.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
            <label className="block text-sm font-medium text-slate-800 mb-1">
              Sale / transaction date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              max={todayDateInputValue()}
              className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
            />
            <p className="text-xs text-slate-600 mt-2">
              Pick the <strong>actual sale date</strong> when encoding a past transaction (e.g. sold last night, entered
              today). This date is used on receipts, accounts receivable, dashboard activity, and{' '}
              <strong>Sales summary</strong> reports.
            </p>
            <label className="mt-3 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={historicalSale}
                onChange={(e) => {
                  setHistoricalSale(e.target.checked);
                  setDraftItemType('Product');
                  setSelectedItemId('');
                  setMigrationProductName('');
                  setServiceName('');
                  setDraftCostPerUnit(0);
                  setCart([]);
                }}
              />
              <span className="text-sm text-slate-700">
                <strong>Past sale / migration</strong> — product was sold before this system or is not in inventory.
                Stock is <strong>not</strong> deducted; sale still appears in reports and receivables.
              </span>
            </label>
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer <span className="text-red-500">*</span></label>
            <input
              type="text"
              className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
              placeholder="Type or select customer"
              value={selectedPersonId ? persons.find((p) => p.id === selectedPersonId)?.fullName ?? customerInput : customerInput}
              onChange={(e) => {
                setCustomerInput(e.target.value);
                setSelectedPersonId('');
                setIsPersonDropdownOpen(true);
              }}
              onFocus={() => setIsPersonDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsPersonDropdownOpen(false), 200)}
            />
            <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
            {isPersonDropdownOpen && personSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {personSuggestions.slice(0, 15).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm border-b border-slate-50 last:border-0"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedPersonId(p.id);
                      setCustomerInput(p.fullName);
                      setSelectedVehicleId('');
                      setVehicleInput('');
                      setIsPersonDropdownOpen(false);
                    }}
                  >
                    {p.fullName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle (optional)</label>
            <input
              type="text"
              className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"
              placeholder={selectedPersonId ? 'Type plate or select' : 'Select customer first'}
              value={selectedVehicleId ? vehicles.find((v) => v.id === selectedVehicleId)?.plateNumber ?? vehicleInput : vehicleInput}
              disabled={!selectedPersonId}
              onChange={(e) => {
                setVehicleInput(e.target.value);
                setSelectedVehicleId('');
                setIsVehicleDropdownOpen(true);
              }}
              onFocus={() => selectedPersonId && setIsVehicleDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsVehicleDropdownOpen(false), 200)}
            />
            <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
            {selectedPersonId && isVehicleDropdownOpen && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm text-slate-500"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedVehicleId('');
                    setVehicleInput('');
                    setIsVehicleDropdownOpen(false);
                  }}
                >
                  None
                </button>
                {vehicleSuggestions.slice(0, 10).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedVehicleId(v.id);
                      setVehicleInput(v.plateNumber);
                      setIsVehicleDropdownOpen(false);
                    }}
                  >
                    {v.plateNumber}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50/50">
            <h4 className="font-semibold text-slate-800 text-sm">Add line to cart</h4>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Line type</label>
              <select
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                value={draftItemType}
                onChange={(e) => {
                  setDraftItemType(e.target.value as DraftItemType);
                  setSelectedItemId('');
                  setServiceName('');
                  setMigrationProductName('');
                  setDraftDiscountPerUnit(0);
                }}
                disabled={historicalSale}
              >
                <option value="Product">Product</option>
                <option value="Service">Servicing</option>
              </select>
              {historicalSale && (
                <p className="text-xs text-amber-800 mt-1">Migration mode uses product lines only (manual names allowed).</p>
              )}
            </div>

            {draftItemType === 'Product' ? (
              historicalSale ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Product name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                      placeholder="e.g. N120L/F51L — type what was sold"
                      value={migrationProductName}
                      onChange={(e) => setMigrationProductName(e.target.value)}
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Does not need to exist in inventory. You can still pick a catalog item below to prefill name and
                      price.
                    </p>
                  </div>
                  <div className="relative">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Link to inventory item (optional)
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                      placeholder="Search catalog to prefill…"
                      value={activeDraftItem?.name ?? ''}
                      readOnly
                      onFocus={() => setIsItemDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setIsItemDropdownOpen(false), 200)}
                    />
                    <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
                    {isItemDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {itemSuggestions.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-500">No for-sale items in catalog.</div>
                        ) : (
                          itemSuggestions.map((i) => (
                            <button
                              key={i.id}
                              type="button"
                              className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm border-b border-slate-50"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setSelectedItemId(i.id);
                                setMigrationProductName(i.name);
                                setDraftPrice(i.unitPrice ?? 0);
                                setDraftCostPerUnit(round2(itemCapitalPerUnit(i)));
                                setDraftQty(1);
                                setIsItemDropdownOpen(false);
                              }}
                            >
                              <div className="font-medium">{i.name}</div>
                              <div className="text-xs text-slate-500">
                                Stock: {i.quantity ?? 0} (not deducted) · SRP ₱{itemRetailPerUnit(i).toFixed(2)}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Unit cost (₱) — optional</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="w-full max-w-xs px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                      value={draftCostPerUnit}
                      onChange={(e) => setDraftCostPerUnit(Math.max(0, Number(e.target.value) || 0))}
                    />
                    <p className="text-xs text-slate-500 mt-1">For sales summary COGS. Leave 0 if unknown.</p>
                  </div>
                </div>
              ) : (
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">Item</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  placeholder="Search item..."
                  value={activeDraftItem?.name ?? ''}
                  readOnly
                  onFocus={() => setIsItemDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setIsItemDropdownOpen(false), 200)}
                />
                <ChevronDown className="absolute right-3 top-9 w-4 h-4 text-slate-400 pointer-events-none" />
                {isItemDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {itemSuggestions.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-slate-500">No for-sale items in stock.</div>
                    ) : (
                      itemSuggestions.map((i) => {
                        const reserved = qtyInCartForProduct(cart, i.id);
                        const avail = (i.quantity ?? 0) - reserved;
                        return (
                          <button
                            key={i.id}
                            type="button"
                            className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-sm border-b border-slate-50 disabled:opacity-50"
                            disabled={avail <= 0}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedItemId(i.id);
                              setDraftPrice(i.unitPrice ?? 0);
                              setDraftQty(1);
                              setIsItemDropdownOpen(false);
                            }}
                          >
                            <div className="font-medium">{i.name}</div>
                            <div className="text-xs text-slate-500">
                              Available for cart: {avail} · Cost ₱{itemCapitalPerUnit(i).toFixed(2)} · SRP ₱
                              {itemRetailPerUnit(i).toFixed(2)}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              )
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Servicing name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  placeholder="e.g. Labor, Delivery"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Services have no stock cost; gross profit is selling amount after any per-unit line discount.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  max={
                    draftItemType === 'Product' && activeDraftItem
                      ? Math.max(1, (activeDraftItem.quantity ?? 0) - qtyInCartForProduct(cart, activeDraftItem.id))
                      : 9999
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  value={draftQty}
                  onChange={(e) => setDraftQty(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Unit price (₱)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Discount / unit (₱)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white"
                  value={draftDiscountPerUnit}
                  onChange={(e) => setDraftDiscountPerUnit(Number(e.target.value) || 0)}
                  title="Total line discount = this amount × quantity"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={addDraftToCart}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Add to cart
            </button>
          </div>

          {cart.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-slate-100 text-sm font-semibold text-slate-700">Cart</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3 text-right">Qty</th>
                      <th className="py-2 px-3 text-right">Unit</th>
                      <th className="py-2 px-3 text-right">Disc/unit</th>
                      <th className="py-2 px-3 text-right">Line total</th>
                      <th className="py-2 px-3 text-right">Net</th>
                      <th className="py-2 px-3 text-right">Line COGS</th>
                      <th className="py-2 px-3 text-right">Line margin</th>
                      <th className="py-2 px-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cart.map((line) => {
                      const inv = line.itemId ? items.find((i) => i.id === line.itemId) : undefined;
                      const cpu = line.itemType === 'Product' && inv ? itemCapitalPerUnit(inv) : 0;
                      const gross = lineGross(line);
                      const disc = lineDiscountTotal(line);
                      const netSell = lineNetSelling(line);
                      const lineCogs = line.itemType === 'Product' ? round2(line.qty * cpu) : 0;
                      const lineNet = round2(netSell - lineCogs);
                      const dpu = line.discountPerUnit ?? 0;
                      return (
                        <tr key={line.id}>
                          <td className="py-2 px-3">
                            <div className="font-medium text-slate-800">{line.name}</div>
                            <div className="text-xs text-slate-500">{line.itemType}</div>
                          </td>
                          <td className="py-2 px-3 text-right">{line.qty}</td>
                          <td className="py-2 px-3 text-right">₱{line.unitPrice.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">
                            {dpu > 0 ? `₱${dpu.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right">₱{gross.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-medium">₱{netSell.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">₱{lineCogs.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-emerald-700 font-medium">₱{lineNet.toFixed(2)}</td>
                          <td className="py-2 px-3">
                            <button
                              type="button"
                              onClick={() => removeCartLine(line.id)}
                              className="p-1 text-slate-400 hover:text-red-600"
                              title="Remove"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {cart.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-1 text-sm">
              <div className="flex justify-between text-slate-700">
                <span>Subtotal</span>
                <span className="font-medium">₱{subtotal.toFixed(2)}</span>
              </div>
              {totalLineDiscount > 0 && (
                <div className="flex justify-between text-amber-800">
                  <span>Line discounts (per unit × qty)</span>
                  <span>−₱{totalLineDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-900 font-semibold text-base pt-1 border-t border-emerald-200/80">
                <span>Total due</span>
                <span>₱{grandTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Total COGS (product lines)</span>
                <span>₱{totalCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-emerald-900 font-semibold">
                <span>Gross profit (this sale, before shop expenses)</span>
                <span>₱{netIncome.toFixed(2)}</span>
              </div>
              <p className="text-xs text-slate-500 pt-1">
                Gross profit here = total due minus COGS (after per-line discounts). Monthly{' '}
                <span className="font-medium text-slate-700">net income</span> also subtracts operating expenses — see{' '}
                <span className="font-medium text-slate-700">Sales summary</span> in the sidebar.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Payment <span className="text-red-500">*</span></label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="posPayment"
                  value="Cash"
                  checked={paymentType === 'Cash'}
                  onChange={() => setPaymentType('Cash')}
                  className="text-indigo-600"
                />
                <Banknote className="w-4 h-4 text-green-600" />
                <span>Cash</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="posPayment"
                  value="Purchase Order"
                  checked={paymentType === 'Purchase Order'}
                  onChange={() => setPaymentType('Purchase Order')}
                  className="text-indigo-600"
                />
                <FileText className="w-4 h-4 text-amber-600" />
                <span>Purchase Order</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="posPayment"
                  value="Accounts Receivable"
                  checked={paymentType === 'Accounts Receivable'}
                  onChange={() => setPaymentType('Accounts Receivable')}
                  className="text-indigo-600"
                />
                <CreditCard className="w-4 h-4 text-indigo-600" />
                <span>Accounts Receivable</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="posPayment"
                  value="Cheque"
                  checked={paymentType === 'Cheque'}
                  onChange={() => setPaymentType('Cheque')}
                  className="text-indigo-600"
                />
                <ScrollText className="w-4 h-4 text-violet-600" />
                <span>Cheque</span>
              </label>
            </div>
          </div>

          {paymentType === 'Purchase Order' && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-lg space-y-3">
              <h4 className="font-medium text-slate-800">Purchase Order details</h4>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Invoice number <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required={paymentType === 'Purchase Order'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-2025-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Due date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required={paymentType === 'Purchase Order'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Terms <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required={paymentType === 'Purchase Order'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="e.g. Net 30, COD"
                />
              </div>
            </div>
          )}

          {paymentType === 'Accounts Receivable' && (
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment due (days)</label>
              <input
                type="number"
                min={1}
                max={365}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                value={dueDays}
                onChange={(e) => setDueDays(Math.min(365, Math.max(1, Number(e.target.value) || 30)))}
              />
              <p className="text-xs text-slate-500 mt-1">SOA and receivable account will be generated for the total due (after discount).</p>
            </div>
          )}

          {paymentType === 'Cheque' && (
            <div className="p-4 bg-violet-50 border border-violet-100 rounded-lg space-y-3">
              <p className="text-sm text-slate-700">
                The sale posts to <span className="font-medium">accounts receivable</span> until the bank clears the cheque. Use{' '}
                <span className="font-medium">Receivables</span> to mark cleared (cash received) or bounced.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Expected bank clearance date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required={paymentType === 'Cheque'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500"
                  value={chequeExpectedClearDate}
                  onChange={(e) => setChequeExpectedClearDate(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">Receivable due date follows this date. You will be reminded from this date until the cheque is cleared.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cheque reference (optional)</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-violet-500"
                  value={chequeReference}
                  onChange={(e) => setChequeReference(e.target.value)}
                  placeholder="e.g. bank / check number"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Note (optional)</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-5 h-5" />
              {submitting
                ? 'Processing...'
                : paymentType === 'Cash'
                  ? 'Complete Sale, Print Receipt & Billing Statement'
                  : 'Complete Sale & Print Billing Statement'}
            </button>
          </div>
        </form>
        </div>

        <aside className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 lg:sticky lg:top-4 space-y-4 text-sm self-start">
          <div className="flex items-start gap-2">
            <div className="bg-emerald-100 p-2 rounded-lg shrink-0">
              <ScrollText className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base leading-tight">Billing statement (A4)</h3>
              <p className="text-xs text-slate-500 mt-1 leading-snug">
                Same format as History. Print from the live cart (quote) or from the last sale saved to the system.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Registered name</label>
            <input
              type="text"
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500"
              value={bhRegisteredName}
              onChange={(e) => setBhRegisteredName(e.target.value)}
              placeholder="Your registered business name"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">TIN (optional)</label>
            <input
              type="text"
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500"
              value={bhTin}
              onChange={(e) => setBhTin(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Business address</label>
            <textarea
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 min-h-[64px] resize-y"
              value={bhAddress}
              onChange={(e) => setBhAddress(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={bhShowVat}
              onChange={(e) => setBhShowVat(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-slate-700 text-xs leading-snug">
              Show VAT summary ({BILLING_VAT_RATE}% inclusive; net = total ÷ {(1 + BILLING_VAT_RATE / 100).toFixed(2)})
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={bhPrePrintedForm}
              onChange={(e) => {
                setBhPrePrintedForm(e.target.checked);
                saveBillingPrePrintedFormPreference(e.target.checked);
              }}
              className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-slate-700 text-xs leading-snug">
              Pre-printed BIR invoice overlay (≤ 9 items): prints only dynamic values positioned on your physical
              Motor World invoice booklet. Load the pre-printed paper first — no letterhead or borders are printed.
            </span>
          </label>

          {bhPrePrintedForm && (
            <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
              <p className="text-xs font-semibold text-emerald-900">Overlay fields (SOLD TO + invoice)</p>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Invoice serial №</label>
                <input
                  type="text"
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
                  value={bhInvoiceNumber}
                  onChange={(e) => setBhInvoiceNumber(e.target.value)}
                  placeholder="e.g. 000152"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Customer TIN (SOLD TO)</label>
                <input
                  type="text"
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg"
                  value={bhCustomerTin}
                  onChange={(e) => setBhCustomerTin(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Customer address (SOLD TO)</label>
                <input
                  type="text"
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg"
                  value={bhCustomerAddress}
                  onChange={(e) => setBhCustomerAddress(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Cash / Charge checkbox follows payment type. Customer name comes from the POS customer field.
              </p>
              <PrePrintedOverlayCalibrationPanel
                value={overlayCalibration}
                onChange={setOverlayCalibration}
                onPreview={() => {
                  if (cart.length === 0) {
                    setError('Add cart lines to preview the overlay.');
                    return;
                  }
                  const lineRows = billingLineRowsFromPosCart(
                    cart.map((l) => ({
                      name: l.name,
                      itemType: l.itemType,
                      qty: l.qty,
                      unitPrice: l.unitPrice,
                      discountPerUnit: l.discountPerUnit > 0 ? l.discountPerUnit : undefined,
                    }))
                  );
                  const customerLabel = selectedPersonId
                    ? persons.find((p) => p.id === selectedPersonId)?.fullName?.trim()
                    : customerInput.trim();
                  const html = buildBillingStatementHtml(
                    {
                      lineRows,
                      totalDue: grandTotal,
                      footerRef: 'Overlay preview',
                      footerDate: formatDateInputForDisplay(transactionDate),
                      customerName: customerLabel || 'Sample customer',
                      customerTin: bhCustomerTin.trim() || undefined,
                      customerAddress: bhCustomerAddress.trim() || undefined,
                      invoiceNumber: bhInvoiceNumber.trim() || undefined,
                      isChargeSale: isChargeSaleForPrint,
                      documentDate: formatDateInputForDisplay(transactionDate),
                    },
                    billingLetterhead,
                    { ...billingPrintOptions, overlayPreview: true }
                  );
                  openDocumentPreview({
                    html,
                    title: 'Pre-printed overlay preview',
                    filename: 'overlay-preview.pdf',
                  });
                }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => saveBillingLetterhead(billingLetterhead)}
            className="w-full py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            Save letterhead only
          </button>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            <button
              type="button"
              disabled={cart.length === 0 || grandTotal <= 0}
              onClick={printPosBillingFromCart}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              Print from cart
            </button>
            <p className="text-[11px] text-slate-500">Uses current lines, discount, and total — marked as draft until you complete the sale.</p>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            <button
              type="button"
              disabled={!lastSaleForBilling}
              onClick={printPosBillingLastSale}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              Print last saved sale
            </button>
            {lastSaleForBilling ? (
              <p className="text-[11px] text-slate-500">
                Ref. #{lastSaleForBilling.id.slice(0, 8)} · ₱{lastSaleForBilling.totalValue.toFixed(2)} · matches History.
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">Completing a sale stores the transaction here until you leave POS or record another sale.</p>
            )}
            {lastSaleForBilling && (
              <button
                type="button"
                onClick={() => setLastSaleForBilling(null)}
                className="text-xs text-slate-500 hover:text-slate-700 underline"
              >
                Clear last sale reference
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
