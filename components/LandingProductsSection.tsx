import React, { useEffect, useMemo, useState } from 'react';
import { Facebook, Loader2, Package, Search } from 'lucide-react';
import { FACEBOOK_BUSINESS_PAGE_URL } from '../lib/company';
import { fetchMotorWorldPublicProducts, type PublicCatalogProduct } from '../lib/publicCatalog';

const RED = '#E31837';

interface LandingProductsSectionProps {
  sectionShell: string;
  h2: string;
  onCountChange?: (count: number) => void;
}

export const LandingProductsSection: React.FC<LandingProductsSectionProps> = ({
  sectionShell,
  h2,
  onCountChange,
}) => {
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMotorWorldPublicProducts()
      .then((rows) => {
        if (cancelled) return;
        setProducts(rows);
        onCountChange?.(rows.length);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load products.');
        setProducts([]);
        onCountChange?.(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load catalog once on mount
  }, []);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [p.name, p.brand, p.category, p.description].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [products, search, categoryFilter]);

  return (
    <section id="products" className={sectionShell}>
      <div className="mx-auto max-w-5xl">
        <h2 className={h2}>Products</h2>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
          Quality automotive parts and supplies — retail, wholesale, and distribution for effective vehicle
          servicing. <span className="text-zinc-300">Listed below are items currently in stock at Motor World.</span>
        </p>

        <div className="mt-6 relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-lg border border-white/15 bg-zinc-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-600/60 focus:outline-none focus:ring-2 focus:ring-red-600/30"
            autoComplete="off"
          />
        </div>

        {categories.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            <li>
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  categoryFilter === 'all'
                    ? 'border-red-600/80 bg-red-950/50 text-white'
                    : 'border-white/15 bg-zinc-900 text-zinc-200 hover:border-white/30'
                }`}
              >
                All ({products.length})
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat}>
                <button
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                    categoryFilter === cat
                      ? 'border-red-600/80 bg-red-950/50 text-white'
                      : 'border-white/15 bg-zinc-900 text-zinc-200 hover:border-white/30'
                  }`}
                >
                  {cat}
                </button>
              </li>
            ))}
          </ul>
        )}

        {loading && (
          <div className="mt-8 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading inventory…
          </div>
        )}

        {!loading && error && (
          <p className="mt-8 text-sm text-amber-200/90">
            {error} Promos and updates are still on our Facebook page.
          </p>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="mt-8 text-sm text-zinc-400">
            {products.length === 0
              ? 'No retail items in stock to display right now. Check back soon or message us on Facebook.'
              : 'No products match your search.'}
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-white/10 bg-zinc-950/80 p-4 transition hover:border-white/20"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900"
                    aria-hidden
                  >
                    <Package className="h-5 w-5 text-zinc-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white leading-snug">{p.name}</p>
                    {p.brand && <p className="text-xs text-zinc-500 mt-0.5">{p.brand}</p>}
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{p.category}</p>
                    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-bold text-white">
                        ₱{p.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <span className="text-xs font-normal text-zinc-500"> / {p.unit}</span>
                      </p>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90">
                        In stock
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 text-sm text-zinc-400">
          Stock updates and promos are also posted on our Facebook page.
        </p>
        <a
          href={FACEBOOK_BUSINESS_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white underline decoration-red-600 underline-offset-4 hover:decoration-white"
        >
          <Facebook className="h-4 w-4" style={{ color: RED }} aria-hidden />
          View updates on Facebook
        </a>
      </div>
    </section>
  );
};
