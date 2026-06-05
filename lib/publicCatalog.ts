import { publicApiUrl, readPublicApiError } from './publicApi';

export interface PublicCatalogProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  unitPrice: number;
  unit: string;
  quantity: number;
  description?: string;
}

export interface PublicCatalogResponse {
  shopId: string;
  updatedAt: string;
  count: number;
  products: PublicCatalogProduct[];
}

/** Live Motor World retail inventory for the public marketing site (no auth). */
export async function fetchMotorWorldPublicProducts(): Promise<PublicCatalogProduct[]> {
  const res = await fetch(publicApiUrl('/api/public/motorworld/products'), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(await readPublicApiError(res, 'Could not load product catalog.'));
  }
  const data = (await res.json()) as PublicCatalogResponse;
  return Array.isArray(data.products) ? data.products : [];
}
