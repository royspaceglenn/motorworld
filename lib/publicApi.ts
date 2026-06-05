/** Base URL for unauthenticated public site API calls (bookings, product catalog). */
export function getPublicApiBase(): string {
  const runtime =
    typeof window !== 'undefined'
      ? window.motorWorldDesktop?.apiBaseUrl ?? window.efcpDesktop?.apiBaseUrl ?? ''
      : '';
  let base = (runtime || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

  if (typeof window !== 'undefined' && window.location) {
    const { hostname, port } = window.location;
    const devUiPort = String(import.meta.env.VITE_DEV_SERVER_PORT || '5174');
    const isViteDevUi = import.meta.env.DEV && port === devUiPort;
    const isLoopbackHost =
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    const directLocalApi =
      base === '' || base === 'http://127.0.0.1:3001' || base === 'http://localhost:3001';
    if (isViteDevUi && !isLoopbackHost) return '';
    if (isViteDevUi && isLoopbackHost && directLocalApi) return '';
  }

  return base;
}

export function publicApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = getPublicApiBase();
  return base ? `${base}${normalized}` : normalized;
}

export async function readPublicApiError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) {
    if (res.status === 404) {
      return 'Booking service unavailable. The site API URL may not be configured (VITE_API_BASE_URL).';
    }
    return fallback;
  }
  try {
    const data = JSON.parse(text) as { error?: string };
    if (data.error) return data.error;
  } catch {
    if (text.trim().startsWith('<')) {
      return 'Booking service unavailable. The site could not reach the API server.';
    }
  }
  return fallback;
}
