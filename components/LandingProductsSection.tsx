import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Facebook, Loader2, Package, Search, SlidersHorizontal } from 'lucide-react';
import { FACEBOOK_BUSINESS_PAGE_URL } from '../lib/company';
import { fetchMotorWorldPublicProducts, type PublicCatalogProduct } from '../lib/publicCatalog';

const RED = '#E31837';

interface LandingProductsSectionProps {
  sectionShell: string;
  h2: string;
  onCountChange?: (count: number) => void;
  /** When true, render as main catalog content (used on `/products` page). */
  standalone?: boolean;
}

function formatDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (!letters) return trimmed;
  const upper = (trimmed.match(/[A-Z]/g) ?? []).length;
  if (upper / letters.length > 0.75) {
    return trimmed
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/(\d+)([a-z])/gi, (_, n, c) => `${n}${c}`);
  }
  return trimmed;
}

function categoryTone(category: string): string {
  const key = category.toLowerCase();
  if (key.includes('oil') || key.includes('fluid') || key.includes('atf')) return 'bg-amber-950/60 text-amber-200 ring-amber-800/50';
  if (key.includes('filter')) return 'bg-sky-950/60 text-sky-200 ring-sky-800/50';
  if (key.includes('tire') || key.includes('tube')) return 'bg-emerald-950/60 text-emerald-200 ring-emerald-800/50';
  if (key.includes('paint') || key.includes('adhesive')) return 'bg-violet-950/60 text-violet-200 ring-violet-800/50';
  return 'bg-zinc-800/80 text-zinc-300 ring-white/10';
}

function ProductCard({ product }: { product: PublicCatalogProduct }) {
  const displayName = formatDisplayName(product.name);
  const brand = product.brand?.trim();

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/90 to-zinc-950 p-4 shadow-sm transition hover:border-red-600/35 hover:shadow-[0_0_0_1px_rgba(227,24,55,0.15)]">
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-950 ring-1 ring-white/10"
          aria-hidden
        >
          <Package className="h-5 w-5 text-zinc-500 transition group-hover:text-red-400/80" />
        </div>
        <span
          className={`inline-flex max-w-[9rem] items-center justify-end rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ${categoryTone(product.category)}`}
        >
          {product.category}
        </span>
      </div>

      <div className="mt-3 min-h-[4.5rem] flex-1">
        <h3 className="line-clamp-3 text-sm font-semibold leading-snug text-white sm:text-[0.95rem]" title={product.name}>
          {displayName}
        </h3>
        {brand ? (
          <p className="mt-1.5 text-xs font-medium text-zinc-400">{brand}</p>
        ) : (
          <p className="mt-1.5 text-xs text-zinc-600">Motor World</p>
        )}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-white/8 pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">SRP</p>
          <p className="text-base font-bold tabular-nums text-white">
            ₱{product.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="ml-1 text-xs font-medium text-zinc-500">/ {product.unit}</span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-950/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-800/60">
          In stock
        </span>
      </div>
    </article>
  );
}

export const LandingProductsSection: React.FC<LandingProductsSectionProps> = ({
  sectionShell,
  h2,
  onCountChange,
  standalone = false,
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

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const cat = p.category || 'Other';
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
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

  const groupedByCategory = useMemo(() => {
    if (categoryFilter !== 'all' || search.trim()) return null;
    const map = new Map<string, PublicCatalogProduct[]>();
    for (const p of filtered) {
      const cat = p.category || 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
  }, [filtered, categoryFilter, search]);

  const topCategories = categoryCounts.slice(0, 6);

  const Wrapper = standalone ? 'div' : 'section';
  const wrapperClass = standalone
    ? 'mx-auto max-w-6xl'
    : `${sectionShell}`.trim();

  return (
    <Wrapper id={standalone ? undefined : 'products'} className={wrapperClass}>
      <div className={standalone ? undefined : 'mx-auto max-w-6xl'}>
        <div className="max-w-3xl">
          <h2 className={h2}>Products</h2>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">
            Quality automotive parts and supplies — retail, wholesale, and distribution for effective vehicle
            servicing.{' '}
            <span className="text-zinc-300">Browse items currently in stock at Motor World.</span>
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-zinc-950/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="relative min-w-0 flex-1">
              <label htmlFor="product-search" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Search
              </label>
              <Search className="pointer-events-none absolute left-3 top-[2.15rem] h-4 w-4 text-zinc-500" aria-hidden />
              <input
                id="product-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, brand, or category…"
                className="w-full rounded-xl border border-white/15 bg-zinc-950 py-3 pl-10 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-600/60 focus:outline-none focus:ring-2 focus:ring-red-600/30"
                autoComplete="off"
              />
            </div>

            <div className="w-full lg:w-72">
              <label htmlFor="product-category" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Category
              </label>
              <div className="relative">
                <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
                <select
                  id="product-category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/15 bg-zinc-950 py-3 pl-10 pr-10 text-sm text-white focus:border-red-600/60 focus:outline-none focus:ring-2 focus:ring-red-600/30"
                >
                  <option value="all">All categories ({products.length})</option>
                  {categoryCounts.map(([cat, count]) => (
                    <option key={cat} value={cat}>
                      {cat} ({count})
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
              </div>
            </div>
          </div>

          {topCategories.length > 0 && (
            <div className="mt-4 border-t border-white/8 pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Quick filters</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    categoryFilter === 'all'
                      ? 'border-red-600/80 bg-red-950/50 text-white'
                      : 'border-white/15 bg-zinc-900 text-zinc-300 hover:border-white/30 hover:text-white'
                  }`}
                >
                  All
                </button>
                {topCategories.map(([cat, count]) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      categoryFilter === cat
                        ? 'border-red-600/80 bg-red-950/50 text-white'
                        : 'border-white/15 bg-zinc-900 text-zinc-300 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {cat}
                    <span className="ml-1 text-zinc-500">({count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!loading && !error && products.length > 0 && (
          <p className="mt-5 text-sm text-zinc-500">
            Showing <span className="font-semibold text-zinc-300">{filtered.length}</span> of{' '}
            <span className="font-semibold text-zinc-300">{products.length}</span> products
            {categoryFilter !== 'all' ? (
              <>
                {' '}
                in <span className="font-semibold text-zinc-300">{categoryFilter}</span>
              </>
            ) : null}
          </p>
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
              : 'No products match your search or filter.'}
          </p>
        )}

        {!loading && filtered.length > 0 && groupedByCategory && (
          <div className="mt-8 space-y-10">
            {groupedByCategory.map(([category, items]) => (
              <div key={category}>
                <div className="mb-4 flex items-center gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-300">{category}</h3>
                  <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs font-semibold text-zinc-500 ring-1 ring-white/10">
                    {items.length}
                  </span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((p) => (
                    <li key={p.id} className="min-h-[11.5rem]">
                      <ProductCard product={p} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length > 0 && !groupedByCategory && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <li key={p.id} className="min-h-[11.5rem]">
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-sm text-zinc-400">
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
    </Wrapper>
  );
};
