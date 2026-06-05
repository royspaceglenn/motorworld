/** Reserved URL path for the staff operations app (POS, inventory, etc.). Not linked from the public landing page. */
export const OPS_APP_PATH = '/aiosystem';

/** Public catalog page — separate from the main marketing landing. */
export const PUBLIC_PRODUCTS_PATH = '/products';

function normalizePathname(): string {
  if (typeof window === 'undefined') return '/';
  let pathname = window.location.pathname || '/';
  if (pathname.endsWith('/index.html')) {
    pathname = pathname.slice(0, -'/index.html'.length) || '/';
  }
  return pathname.replace(/\/$/, '') || '/';
}

export function isPublicProductsPath(): boolean {
  if (typeof window === 'undefined') return false;
  const normalized = normalizePathname();
  return normalized === PUBLIC_PRODUCTS_PATH || normalized.startsWith(`${PUBLIC_PRODUCTS_PATH}/`);
}

export function isOperationsAppPath(): boolean {
  if (typeof window === 'undefined') return false;

  const hash = (window.location.hash || '').replace(/^#/, '').replace(/\/$/, '') || '';
  if (hash === OPS_APP_PATH || hash.startsWith(`${OPS_APP_PATH}/`)) return true;

  const normalized = normalizePathname();
  return normalized === OPS_APP_PATH || normalized.startsWith(`${OPS_APP_PATH}/`);
}
