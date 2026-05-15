import React from 'react';
import {
  COMPANY_DISPLAY_NAME,
  FACEBOOK_BUSINESS_PAGE_URL,
  PUBLIC_SITE_HOST,
} from '../lib/company';
import { OPS_APP_PATH } from '../lib/opsPath';
import { MapPin, Wrench, Car, Facebook, Shield } from 'lucide-react';

/**
 * Marketing landing for motorworldcorp.com. No link to the staff POS / operations URL
 * (see {@link OPS_APP_PATH}) — staff use a bookmark or typed URL only.
 */
export const PublicLanding: React.FC = () => {
  const staffUrlExample =
    typeof window !== 'undefined'
      ? `${window.location.origin}${OPS_APP_PATH}`
      : `https://${PUBLIC_SITE_HOST}${OPS_APP_PATH}`;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.22),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(14,165,233,0.12),_transparent_50%),#f8fafc] text-slate-800">
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-sky-600 text-white shadow-lg shadow-indigo-500/25">
              <Shield className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">Official</p>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{COMPANY_DISPLAY_NAME}</h1>
            </div>
          </div>
          <a
            href={FACEBOOK_BUSINESS_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/80"
          >
            <Facebook className="h-4 w-4 text-indigo-600" aria-hidden />
            Follow us on Facebook
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-indigo-600/90">
          General Santos City
        </p>
        <h2 className="mt-3 text-center text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
          Parts, service, and vehicles you can trust
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-base leading-relaxed text-slate-600 sm:text-lg">
          {COMPANY_DISPLAY_NAME} serves drivers and fleets in General Santos City with quality parts,
          dependable workshop service, and curated vehicle options. Stay connected for updates, promos, and
          inventory highlights on our official Facebook page.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <article className="rounded-3xl border border-slate-200/90 bg-white/90 p-6 shadow-sm shadow-slate-200/40">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
              <Wrench className="h-5 w-5" aria-hidden />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">Service &amp; parts</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Maintenance, diagnostics, and parts support to keep your vehicle road-ready.
            </p>
          </article>
          <article className="rounded-3xl border border-slate-200/90 bg-white/90 p-6 shadow-sm shadow-slate-200/40">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <Car className="h-5 w-5" aria-hidden />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">Auto sales</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Browse listings and announcements we post for the local market—see Facebook for the latest units.
            </p>
          </article>
          <article className="rounded-3xl border border-slate-200/90 bg-white/90 p-6 shadow-sm shadow-slate-200/40">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <MapPin className="h-5 w-5" aria-hidden />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">Local to GenSan</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Rooted in General Santos City—message us on Facebook for directions, hours, and how we can help.
            </p>
          </article>
        </div>

        <div className="mt-12 rounded-[28px] border border-slate-200 bg-white/95 p-6 text-center shadow-sm sm:p-10">
          <p className="text-sm font-medium text-slate-700">Official site</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{PUBLIC_SITE_HOST}</p>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
            You are on our public home page. Product updates, vehicles, and promos are shared on{' '}
            <a
              href={FACEBOOK_BUSINESS_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700"
            >
              Facebook
            </a>
            —follow us there so you do not miss announcements.
          </p>
        </div>

        <section className="mt-10 rounded-3xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-center sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Authorized staff only</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            The sales and operations console is not linked from this page. Your administrator should give you the
            full URL or bookmark. On this host, staff open the following address (copy from the bar; it is not a
            link):
          </p>
          <p className="mt-4 inline-block max-w-full select-all break-all rounded-xl border border-slate-200 bg-white px-4 py-2 font-mono text-sm text-slate-900">
            {staffUrlExample}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            When your public domain is live at <span className="font-medium text-slate-700">{PUBLIC_SITE_HOST}</span>,
            the same path applies: <span className="font-mono text-[12px]">https://{PUBLIC_SITE_HOST}{OPS_APP_PATH}</span>
          </p>
        </section>
      </main>

      <footer className="border-t border-slate-200/90 bg-white/60 py-8 text-center text-xs text-slate-500">
        <p>&copy; {new Date().getFullYear()} {COMPANY_DISPLAY_NAME}</p>
        <p className="mt-1">General Santos City, Philippines</p>
      </footer>
    </div>
  );
};
