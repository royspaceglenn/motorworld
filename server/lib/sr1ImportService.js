import {
  addTransaction,
  createPerson,
  createVehicle,
  getAllItems,
  getItemById,
  getPersons,
  getTransactions,
  getVehicles,
  updateItem,
  syncReceivablesForRelease,
  upsertDocumentArchivesForRelease,
} from '../db/store.js';
import { buildReceivablePayloadFromSale } from './salesRegisterImport/paymentColumns.js';
import { logActivity } from '../services/activityLogger.js';

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function norm(s) {
  return String(s || '')
    .trim()
    .toUpperCase();
}

function salesRegisterImportSourceNote(fileName, sale, formatLabel) {
  const fmt = String(formatLabel || 'Sales register').trim() || 'Sales register';
  return `[${fmt} import · ${fileName} · key:${sale.key}]`;
}

function findPersonByName(persons, name) {
  const target = norm(name);
  if (!target || target === '—') return null;
  return (
    persons.find((p) => norm(p.fullName) === target) ||
    persons.find((p) => norm(p.fullName).includes(target) || target.includes(norm(p.fullName))) ||
    null
  );
}

function findVehicleByPlate(vehicles, plate, personId) {
  const target = norm(plate).replace(/\s+/g, '');
  if (!target || target === '—') return null;
  const scoped = personId ? vehicles.filter((v) => v.personId === personId) : vehicles;
  return (
    scoped.find((v) => norm(v.plateNumber).replace(/\s+/g, '') === target) ||
    scoped.find((v) => norm(v.plateNumber).replace(/\s+/g, '').includes(target)) ||
    null
  );
}

function parseCarModel(carModel) {
  const raw = String(carModel || '').trim();
  if (!raw || raw === '—') return { brand: '', model: '' };
  const slash = raw.indexOf('/');
  if (slash > 0) {
    return { brand: raw.slice(0, slash).trim(), model: raw.slice(slash + 1).trim() };
  }
  return { brand: raw, model: '' };
}

function findItemForLine(items, line) {
  const code = norm(line.itemCode);
  if (code) {
    const byCode = items.find((i) => norm(i.itemCode) === code);
    if (byCode) return byCode;
  }
  const desc = norm(line.description);
  if (desc) {
    const byName = items.find((i) => norm(i.name) === desc || norm(i.name).includes(desc));
    if (byName) return byName;
  }
  return null;
}

function isDuplicateSale(existing, sale, fileName, formatLabel) {
  const noteKey = salesRegisterImportSourceNote(fileName, sale, formatLabel);
  return existing.some((t) => {
    if (t.type !== 'RELEASE') return false;
    if (String(t.note || '').includes(`key:${sale.key}`)) return true;
    const sameReceipt =
      sale.bsNo &&
      sale.bsNo !== '—' &&
      String(t.receiptNumber || '').trim() === String(sale.bsNo).trim();
    const sameDay =
      sale.saleDateIso &&
      String(t.timestamp || '').slice(0, 10) === String(sale.saleDateIso).slice(0, 10);
    const sameCustomer = norm(t.recipient) === norm(sale.customerName);
    return sameReceipt && sameDay && sameCustomer;
  });
}

async function deductStockForPosLines(posLineItems, saleTimestamp, receiptNumber) {
  const productLines = posLineItems.filter((l) => l.itemType === 'Product' && l.itemId);
  let unitsDeducted = 0;

  for (const line of productLines) {
    const lineQty = Math.abs(Number(line.quantity) || 0);
    if (lineQty <= 0) continue;
    const inv = await getItemById(line.itemId);
    if (!inv) continue;
    await updateItem(inv.id, {
      quantity: inv.quantity - lineQty,
      unitPrice: inv.unitPrice,
      lastUpdated: saleTimestamp,
      receiptNumber: receiptNumber ?? inv.receiptNumber ?? null,
    });
    unitsDeducted += lineQty;
  }

  return unitsDeducted;
}

function buildPosLineItems(lines, items) {
  return lines.map((line) => {
    const inv = findItemForLine(items, line);
    const isLotService = String(line.uom || '').toLowerCase() === 'lot';
    const itemType = isLotService && !inv ? 'Service' : 'Product';
    const dpu = line.qty > 0 ? round2(line.discountPeso / line.qty) : 0;
    return {
      itemId: itemType === 'Product' && inv ? inv.id : null,
      itemName: line.description || line.itemCode || 'Line item',
      itemType,
      quantity: line.qty,
      unitPrice: line.unitPrice,
      lineSubtotal: line.totalPrice,
      discountPerUnit: dpu > 0 ? dpu : null,
      costPerUnit: line.costPerUnit > 0 ? line.costPerUnit : null,
      unmatchedInventory: itemType === 'Product' && !inv,
    };
  });
}

function resolveImportCustomerName(sale) {
  if (sale.customerName && sale.customerName !== '—') return sale.customerName;
  if (sale.plateNo && sale.plateNo !== '—') return `Vehicle ${sale.plateNo}`;
  if (sale.invoiceRef && sale.invoiceRef !== '—') return `Invoice ${sale.invoiceRef}`;
  return 'Walk-in customer';
}

export async function applySr1Import(payload, user) {
  const sales = Array.isArray(payload?.sales) ? payload.sales : [];
  const fileName = String(payload?.sourceFileName || 'register.pdf').trim() || 'register.pdf';
  const formatLabel = String(payload?.formatLabel || payload?.formatId || 'Sales register').trim();
  const skipDuplicates = payload?.skipDuplicates === true;

  if (sales.length === 0) {
    throw new Error('No sales to import.');
  }

  let persons = await getPersons();
  let vehicles = await getVehicles();
  const items = await getAllItems();
  const existing = await getTransactions();

  const result = {
    created: 0,
    skipped: 0,
    personsCreated: 0,
    vehiclesCreated: 0,
    receivablesCreated: 0,
    stockUnitsDeducted: 0,
    transactionIds: [],
    errors: [],
  };

  for (const sale of sales) {
    try {
      if (skipDuplicates && isDuplicateSale(existing, sale, fileName, formatLabel)) {
        result.skipped += 1;
        continue;
      }

      const customerName = resolveImportCustomerName(sale);
      let person = findPersonByName(persons, customerName);
      if (!person) {
        person = await createPerson({
          fullName: customerName,
          contactNumber: '',
          address: sale.address && sale.address !== '—' ? sale.address : '',
        });
        persons = [...persons, person];
        result.personsCreated += 1;
      }

      let vehicle = null;
      if (person && sale.plateNo && sale.plateNo !== '—') {
        vehicle = findVehicleByPlate(vehicles, sale.plateNo, person.id);
        if (!vehicle) {
          const { brand, model } = parseCarModel(sale.carModel);
          vehicle = await createVehicle({
            personId: person.id,
            plateNumber: sale.plateNo.replace(/\s+/g, ' ').trim(),
            brand: brand || undefined,
            model: model || undefined,
          });
          vehicles = [...vehicles, vehicle];
          result.vehiclesCreated += 1;
        }
      }

      const builtLines = buildPosLineItems(sale.lines || [], items);
      const hasUnmatchedInventory = builtLines.some((l) => l.unmatchedInventory);
      const posLineItems = builtLines.map(({ unmatchedInventory: _u, ...line }) => line);
      const totalUnits = posLineItems.reduce((s, l) => s + Math.abs(Number(l.quantity) || 0), 0);
      const itemSummary = posLineItems
        .map((l) => l.itemName)
        .join(', ')
        .slice(0, 200);
      const primaryProduct = posLineItems.find((l) => l.itemType === 'Product' && l.itemId);

      const saleTimestamp = sale.saleDateIso || new Date().toISOString();
      const receiptNumber =
        sale.bsNo && sale.bsNo !== '—' ? String(sale.bsNo) : sale.crNo || null;

      const stockUnits = await deductStockForPosLines(posLineItems, saleTimestamp, receiptNumber);
      result.stockUnitsDeducted += stockUnits;

      const noteParts = [
        salesRegisterImportSourceNote(fileName, sale, formatLabel),
        sale.dateCovered ? `Period: ${sale.dateCovered}` : '',
        sale.crNo ? `CR ${sale.crNo}` : '',
        'Sales register PDF migration import',
        hasUnmatchedInventory ? 'Some lines kept without inventory match for full audit trail' : '',
      ].filter(Boolean);

      const tx = await addTransaction({
        id: crypto.randomUUID(),
        type: 'RELEASE',
        itemId: primaryProduct?.itemId ?? null,
        itemName: itemSummary || 'SR-1 sale',
        itemType: posLineItems.some((l) => l.itemType === 'Product') ? 'Product' : 'Service',
        quantityChange: -Math.max(1, totalUnits),
        unitPriceAtTime:
          totalUnits > 0 ? round2(sale.totalValue / totalUnits) : round2(sale.totalValue),
        totalValue: round2(sale.totalValue),
        subtotalBeforeDiscount: round2(sale.subtotalBeforeDiscount),
        discountAmount: sale.totalDiscount > 0 ? round2(sale.totalDiscount) : null,
        totalCostAtTime: round2(sale.totalCost),
        netIncome: round2(sale.totalValue - sale.totalCost),
        timestamp: saleTimestamp,
        recipient: customerName,
        note: noteParts.join(' · '),
        receiptNumber,
        invoiceNumber:
          sale.poNo && sale.poNo !== '—'
            ? String(sale.poNo)
            : sale.invoiceRef && sale.invoiceRef !== '—'
              ? String(sale.invoiceRef)
              : null,
        modeOfPayment: sale.modeOfPayment || 'Cash',
        terms: sale.terms && sale.terms !== '—' ? sale.terms : null,
        dueDays: sale.dueDays || undefined,
        personId: person?.id ?? null,
        vehicleId: vehicle?.id ?? null,
        posLineItems,
        bundledSale: posLineItems.length > 1,
        releasedBy: user?.displayName || user?.email || 'Register import',
      });

      existing.unshift(tx);

      let soaId = null;
      const receivablePayload = {
        ...buildReceivablePayloadFromSale(sale, person?.id ?? null, vehicle?.id ?? null),
        posLineItems,
        discountAmount: sale.totalDiscount > 0 ? round2(sale.totalDiscount) : null,
      };
      try {
        const receivable = await syncReceivablesForRelease(tx, receivablePayload);
        soaId = receivable.soaId;
        if (soaId || String(sale.modeOfPayment || 'Cash').trim() !== 'Cash') {
          result.receivablesCreated += 1;
        }
      } catch (receivableErr) {
        result.errors.push(
          `${customerName} (${sale.saleDate || '—'}): receivable not created — ${receivableErr?.message || 'unknown'}`
        );
      }

      try {
        await upsertDocumentArchivesForRelease(tx, user?.id ?? null, { soaId });
      } catch (archiveErr) {
        result.errors.push(
          `${customerName} (${sale.saleDate || '—'}): archived copy failed — ${archiveErr?.message || 'unknown'}`
        );
      }
      result.created += 1;
      result.transactionIds.push(tx.id);
    } catch (e) {
      result.errors.push(
        `${resolveImportCustomerName(sale)} (${sale.saleDate || '—'}): ${e?.message || 'Import failed'}`
      );
    }
  }

  await logActivity(user?.id, 'SALES_REGISTER_IMPORT', {
    fileName,
    formatLabel,
    created: result.created,
    skipped: result.skipped,
    personsCreated: result.personsCreated,
    vehiclesCreated: result.vehiclesCreated,
    errors: result.errors.length,
  });

  return result;
}
