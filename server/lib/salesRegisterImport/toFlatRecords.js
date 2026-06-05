/**
 * Map parsed SR-1 sales into flat ledger rows for API preview / external integrations.
 */
export function salesToFlatRecords(parseResult) {
  const records = [];
  for (const sale of parseResult.sales || []) {
    for (const line of sale.lines || []) {
      records.push({
        transaction_id: sale.key,
        date: sale.saleDate,
        date_iso: sale.saleDateIso,
        date_covered: sale.dateCovered || null,
        cr_no: sale.crNo || null,
        bs_no: sale.bsNo || null,
        po_no: sale.poNo !== '—' ? sale.poNo : null,
        invoice_ref: sale.invoiceRef !== '—' ? sale.invoiceRef : null,
        customer_name: sale.customerName !== '—' ? sale.customerName : null,
        address: sale.address !== '—' ? sale.address : null,
        vehicle_model: sale.carModel !== '—' ? sale.carModel : null,
        plate_no: sale.plateNo !== '—' ? sale.plateNo : null,
        item_code: line.itemCode || null,
        item_name: line.description !== '—' ? line.description : null,
        supplier_name: line.supplierName !== '—' ? line.supplierName : null,
        quantity: line.qty,
        uom: line.uom,
        unit_cost: line.costPerUnit,
        total_cost: line.totalCost,
        unit_price: line.unitPrice,
        line_total: line.totalPrice,
        transaction_total: line.transactionTotal,
        discount_amount: line.discountPeso > 0 ? line.discountPeso : null,
        discount_percent: line.discountPercent > 0 ? line.discountPercent : null,
        mode_of_payment: sale.modeOfPayment || 'Cash',
      });
    }
  }
  return records;
}
