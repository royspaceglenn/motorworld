import React from 'react';
import { COMPANY_DISPLAY_NAME, PUBLIC_SITE_HOST } from '../lib/company';
import { LandingProductsSection } from './LandingProductsSection';
import { PublicSiteHeader } from './PublicSiteHeader';

const ASPHALT = '#0a0a0a';
const h2 = 'text-2xl font-black uppercase tracking-tight text-white sm:text-3xl';

/**
 * Dedicated public products catalog at `/products` (separate tab from the main landing page).
 */
export const PublicProductsPage: React.FC = () => {
  return (
    <div
      className="relative min-h-screen overflow-x-hidden text-zinc-200 antialiased"
      style={{ backgroundColor: ASPHALT }}
    >
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.14]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '180px 180px',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-zinc-900/80 via-transparent to-black"
        aria-hidden
      />

      <div className="relative z-10">
        <PublicSiteHeader active="products" />

        <main className="px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <LandingProductsSection sectionShell="" h2={h2} standalone />
        </main>

        <footer className="border-t border-white/10 px-4 py-6 text-center text-[10px] uppercase tracking-wider text-zinc-600">
          © {new Date().getFullYear()} {COMPANY_DISPLAY_NAME} · {PUBLIC_SITE_HOST}
        </footer>
      </div>
    </div>
  );
};
