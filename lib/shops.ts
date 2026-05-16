/** Must match `server/lib/shops.js` ids (REST multi-store). */
import { COMPANY_DISPLAY_NAME } from './company';

export const SHOPS = [
  {
    id: 'motorworld' as const,
    label: 'Motor World Auto Services and Sales Corporation',
    shortLabel: 'Motor World',
  },
  {
    id: 'ecfp' as const,
    label: 'ECFP MOTOR PARTS TRADING',
    shortLabel: 'ECFP',
  },
];

export type ShopId = (typeof SHOPS)[number]['id'];

export const SHOP_IDS: ShopId[] = SHOPS.map((s) => s.id);

/** Top-left workspace branding for REST multi-store (sidebar + mobile chrome). */
export function workspaceBrand(
  shopId: string | null | undefined,
  isFirebaseBackend: boolean
): { title: string; tagline: string } {
  if (isFirebaseBackend) {
    return { title: COMPANY_DISPLAY_NAME, tagline: 'All-in-One Management' };
  }
  const id: ShopId = shopId === 'ecfp' ? 'ecfp' : 'motorworld';
  const meta = SHOPS.find((s) => s.id === id);
  return {
    title: meta?.label ?? COMPANY_DISPLAY_NAME,
    tagline: id === 'ecfp' ? 'ECFP — operations workspace' : 'All-in-One Management',
  };
}
