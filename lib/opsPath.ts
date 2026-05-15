/** Reserved URL path for the staff operations app (POS, inventory, etc.). Not linked from the public landing page. */
export const OPS_APP_PATH = '/aiosystem';

export function isOperationsAppPath(): boolean {
  if (typeof window === 'undefined') return false;

  const hash = (window.location.hash || '').replace(/^#/, '').replace(/\/$/, '') || '';
  if (hash === OPS_APP_PATH || hash.startsWith(`${OPS_APP_PATH}/`)) return true;

  let pathname = window.location.pathname || '/';
  if (pathname.endsWith('/index.html')) {
    pathname = pathname.slice(0, -'/index.html'.length) || '/';
  }
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === OPS_APP_PATH || normalized.startsWith(`${OPS_APP_PATH}/`);
}
