import { SHOPS, type ShopId } from './shops';

export type ReceiptBranding = {
  shopId: ShopId;
  businessName: string;
  receiptSubtitle: string;
  accentColor: string;
  storeCode: string;
};

/** Receipt / OR layout: Motor World vs ECFP (legacy rows without shop → Motor World). */
export function getReceiptBranding(shopId: string | null | undefined): ReceiptBranding {
  const id: ShopId = shopId === 'ecfp' ? 'ecfp' : 'motorworld';
  const meta = SHOPS.find((s) => s.id === id)!;
  if (id === 'ecfp') {
    return {
      shopId: id,
      businessName: meta.label,
      receiptSubtitle: 'Official Receipt — ECFP',
      accentColor: '#1e3a8a',
      storeCode: 'ECFP',
    };
  }
  return {
    shopId: id,
    businessName: meta.label,
    receiptSubtitle: 'Official Receipt',
    accentColor: '#b91c1c',
    storeCode: 'MW',
  };
}
