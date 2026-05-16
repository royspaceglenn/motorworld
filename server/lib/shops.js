/** Logical stores sharing one API + database (isolated JSON collections per shop). */
export const SHOPS = [
  {
    id: 'motorworld',
    label: 'Motor World Auto Services and Sales Corporation',
    shortLabel: 'Motor World',
  },
  {
    id: 'ecfp',
    label: 'ECFP MOTOR PARTS TRADING',
    shortLabel: 'ECFP',
  },
];

export const SHOP_IDS = SHOPS.map((s) => s.id);

export const DEFAULT_SHOP_ID = 'motorworld';

export function isValidShopId(id) {
  return SHOP_IDS.includes(String(id || '').trim());
}

export function shopLabel(id) {
  return SHOPS.find((s) => s.id === id)?.label ?? id;
}
