import React, { useEffect, useState } from 'react';
import {
  COMPANY_DISPLAY_NAME,
  COMPANY_EXPANSION_NOTE,
  COMPANY_MISSION,
  COMPANY_PHILGEPS_NOTE,
  COMPANY_PRODUCTS,
  COMPANY_SERVICE_AREAS,
  COMPANY_SERVICES,
  COMPANY_STORY_INTRO,
  COMPANY_VALUES,
  COMPANY_VISION,
  FACEBOOK_BUSINESS_PAGE_URL,
  PUBLIC_SITE_HOST,
} from '../lib/company';
import { OPS_APP_PATH } from '../lib/opsPath';
import {
  Wrench,
  Facebook,
  ArrowRight,
  Shield,
  Phone,
  Gauge,
  MapPin,
} from 'lucide-react';
import { LandingBookingSection } from './LandingBookingSection';
import { LandingHeroVideo } from './LandingHeroVideo';
import { LandingProductsSection } from './LandingProductsSection';

/** Services bento — mechanic / engine bay (Unsplash). */
const SERVICE_MECHANIC_BG =
  'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&w=1200&q=82';
/** Quick-service card — dark vehicle detail. */
const SERVICE_TEXTURE_BG =
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=82';

const RED = '#E31837';
const YELLOW = '#FFD400';
const ASPHALT = '#0a0a0a';

/**
 * Dark automotive marketing landing (Motor World mockup style).
 * Staff POS path is never linked — see {@link OPS_APP_PATH}.
 */
export const PublicLanding: React.FC = () => {
  const [liveProductCount, setLiveProductCount] = useState<number | null>(null);

  const staffUrlExample =
    typeof window !== 'undefined'
      ? `${window.location.origin}${OPS_APP_PATH}`
      : `https://${PUBLIC_SITE_HOST}${OPS_APP_PATH}`;

  useEffect(() => {
    const hash = (typeof window !== 'undefined' && window.location.hash) || '';
    const id = hash.replace(/^#/, '').trim();
    if (!id) return;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(t);
  }, []);

  const navItem =
    'text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400 transition hover:text-white sm:text-xs';

  const sectionShell = 'scroll-mt-24 border-t border-white/10 bg-black/40 px-4 py-14 sm:px-6 lg:px-8';
  const h2 = 'text-2xl font-black uppercase tracking-tight text-white sm:text-3xl';

  return (
    <div
      className="relative min-h-screen overflow-x-hidden text-zinc-200 antialiased"
      style={{ backgroundColor: ASPHALT }}
    >
      {/* Asphalt / grain texture */}
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
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <a href="#" className="flex shrink-0 items-center gap-2 text-white" aria-label="Top of page">
              <Wrench className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: RED }} aria-hidden />
              <span className="text-sm font-black uppercase tracking-[0.18em] sm:text-base">Motorworld</span>
            </a>

            <nav
              className="hidden flex-1 justify-center gap-6 md:flex lg:gap-10"
              aria-label="Primary"
            >
              <a className={navItem} href="#services">
                Services
              </a>
              <a className={navItem} href="#products">
                Products
              </a>
              <a className={navItem} href="#about">
                About
              </a>
              <a className={navItem} href="#vision">
                Vision
              </a>
              <a className={navItem} href="#faq">
                FAQ
              </a>
            </nav>

            <a
              href="#booking"
              className="shrink-0 rounded-sm px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-lg transition hover:opacity-95 sm:px-5 sm:text-xs"
              style={{ backgroundColor: RED }}
            >
              Book service
            </a>
          </div>
          <div className="flex justify-center gap-4 overflow-x-auto border-t border-white/5 px-4 py-2 md:hidden">
            <a className={`${navItem} whitespace-nowrap`} href="#services">
              Services
            </a>
            <a className={`${navItem} whitespace-nowrap`} href="#products">
              Products
            </a>
            <a className={`${navItem} whitespace-nowrap`} href="#about">
              About
            </a>
            <a className={`${navItem} whitespace-nowrap`} href="#vision">
              Vision
            </a>
            <a className={`${navItem} whitespace-nowrap`} href="#faq">
              FAQ
            </a>
          </div>
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:grid lg:grid-cols-2 lg:items-center lg:gap-10 lg:px-8 lg:pb-24">
          <div className="max-w-xl lg:max-w-none">
            <p className="text-[11px] font-bold uppercase tracking-[0.35em]" style={{ color: RED }}>
              Sarangani roots · Mindanao-wide service
            </p>
            <h1 className="mt-4 text-4xl font-black uppercase leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Trusted automotive{' '}
              <span style={{ color: RED }}>services</span>
              <br />
              &amp; <span style={{ color: RED }}>solutions.</span>
            </h1>
            <p className="mt-6 text-sm leading-relaxed text-zinc-300 sm:text-base">
              {COMPANY_STORY_INTRO} Headquartered in{' '}
              <span className="font-semibold text-white">General Santos City</span>, we serve private owners, commercial
              fleets, and institutional clients across Mindanao.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={FACEBOOK_BUSINESS_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-sm px-6 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-lg transition hover:opacity-95"
                style={{ backgroundColor: RED }}
              >
                Book a service
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a
                href="#products"
                className="inline-flex items-center gap-2 rounded-sm border-2 border-white/90 bg-transparent px-6 py-3 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-white/10"
              >
                View products
              </a>
            </div>
            <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-white/10 pt-10 sm:gap-8">
              <div>
                <dt className="text-2xl font-black text-white sm:text-3xl">{COMPANY_SERVICES.length}</dt>
                <dd className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-xs">
                  Core services
                </dd>
              </div>
              <div>
                <dt className="text-2xl font-black text-white sm:text-3xl">
                  {liveProductCount ?? COMPANY_PRODUCTS.length}
                </dt>
                <dd className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-xs">
                  {liveProductCount != null ? 'In stock now' : 'Product lines'}
                </dd>
              </div>
              <div>
                <dt className="text-2xl font-black text-white sm:text-3xl">2023</dt>
                <dd className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:text-xs">
                  GenSan branch
                </dd>
              </div>
            </dl>
          </div>

          {/* Hero visual — company showcase video */}
          <div className="relative mx-auto mt-12 max-w-md lg:mx-0 lg:mt-0 lg:max-w-none">
            <div className="relative aspect-[4/3] overflow-hidden rounded-sm border border-white/10 shadow-2xl shadow-black/80 sm:aspect-video lg:aspect-[16/10] lg:min-h-[280px]">
              <LandingHeroVideo />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />

              <div
                className="absolute left-3 top-3 max-w-[11rem] rounded-sm px-2 py-1.5 text-[9px] font-black uppercase leading-tight tracking-wide text-black shadow-md sm:left-4 sm:top-4 sm:max-w-[13rem] sm:px-3 sm:py-2 sm:text-[10px]"
                style={{ backgroundColor: YELLOW }}
              >
                PHILGEPS · Gov&apos;t supplier
              </div>

              <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-2 sm:left-3">
                <a
                  href={FACEBOOK_BUSINESS_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/20 bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80 sm:h-10 sm:w-10"
                  aria-label="Warranty and trust"
                >
                  <Shield className="h-4 w-4" aria-hidden />
                </a>
                <a
                  href={FACEBOOK_BUSINESS_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/20 bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80 sm:h-10 sm:w-10"
                  aria-label="Service"
                >
                  <Wrench className="h-4 w-4" style={{ color: RED }} aria-hidden />
                </a>
                <a
                  href={FACEBOOK_BUSINESS_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-white/20 bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80 sm:h-10 sm:w-10"
                  aria-label="Contact on Facebook"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                </a>
              </div>

              <div className="absolute bottom-0 left-0 right-0 flex items-stretch gap-0 border-t border-white/10 bg-black/75 backdrop-blur-md">
                <div className="flex w-12 shrink-0 items-center justify-center sm:w-14" style={{ backgroundColor: RED }}>
                  <Gauge className="h-5 w-5 text-white sm:h-6 sm:w-6" aria-hidden />
                </div>
                <div className="flex flex-1 flex-col justify-center px-3 py-2 sm:px-4 sm:py-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 sm:text-[10px]">
                    Auto scanner diagnostics
                  </p>
                  <p className="text-[11px] font-black uppercase tracking-wide text-white sm:text-xs">
                    Skilled technicians · modern equipment
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className={sectionShell}>
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-end lg:gap-12">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.35em]" style={{ color: RED }}>
                  — 02 — Services
                </p>
                <h2 className="mt-4 text-3xl font-black uppercase leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-5xl">
                  Products &amp; services for every vehicle class.
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base lg:pb-1">
                Autos, trucks, and heavy equipment — for private owners, commercial fleets, and institutional
                clients. Strict quality standards, skilled technicians, and modern equipment.
              </p>
            </div>

            <div className="mt-10 hidden grid-cols-1 gap-4 lg:grid-cols-2 lg:grid-rows-2 lg:gap-4" aria-hidden>
              {/* Tall left — certified mechanics */}
              <article className="relative min-h-[380px] overflow-hidden rounded-xl border border-white/10 shadow-xl lg:row-span-2 lg:min-h-[520px]">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.15) 100%), url(${SERVICE_MECHANIC_BG})`,
                  }}
                />
                <div
                  className="absolute left-4 top-4 rounded-sm px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white sm:left-5 sm:top-5 sm:px-3 sm:py-1.5 sm:text-[11px]"
                  style={{ backgroundColor: RED }}
                >
                  Certified mechanics
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-7">
                  <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-white sm:text-2xl">
                    Hands that know every bolt.
                  </h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-300 sm:text-[15px]">
                    Our certified technicians bring 15+ years of grease, grit, and serious horsepower expertise to every
                    job.
                  </p>
                </div>
              </article>

              {/* Top right — quick service */}
              <article className="relative min-h-[220px] overflow-hidden rounded-xl border border-white/10 shadow-xl lg:min-h-0">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `linear-gradient(160deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.85) 100%), url(${SERVICE_TEXTURE_BG})`,
                  }}
                />
                <div className="relative flex h-full min-h-[220px] flex-col p-5 sm:p-6 lg:min-h-[248px]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-orange-400">Quick service</p>
                  <h3 className="mt-3 text-2xl font-black uppercase leading-tight tracking-tight sm:text-3xl">
                    <span className="text-white">Oil change in under </span>
                    <span style={{ color: RED }}>30 min.</span>
                  </h3>
                  <p className="mt-4 text-4xl font-black tabular-nums text-white sm:text-5xl">₱899</p>
                  <p className="mt-auto self-end text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    From*
                  </p>
                </div>
              </article>

              {/* Bottom right — general repair */}
              <article className="relative flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950 p-5 shadow-xl sm:p-6 lg:min-h-[248px]">
                <div className="flex items-start justify-between gap-3">
                  <Wrench className="h-6 w-6 shrink-0" style={{ color: RED }} aria-hidden />
                  <span
                    className="rounded-sm px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-black sm:text-[10px]"
                    style={{ backgroundColor: YELLOW }}
                  >
                    Most popular
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-black uppercase tracking-tight text-white sm:text-2xl">General repair</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400">
                  Engine, transmission, brakes, suspension — fixed right the first time.
                </p>
                <a
                  href={FACEBOOK_BUSINESS_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-zinc-400 transition hover:text-white"
                >
                  Learn more
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              </article>
            </div>
            <ul className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COMPANY_SERVICES.map((name) => (
                <li
                  key={name}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-zinc-950/80 px-4 py-3"
                >
                  <Wrench className="mt-0.5 h-4 w-4 shrink-0" style={{ color: RED }} aria-hidden />
                  <span className="text-sm font-medium text-zinc-200">{name}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center text-[10px] text-zinc-600 sm:text-left">
              Contact us on Facebook for quotes, fleet schedules, and service availability.
            </p>
          </div>
        </section>

        <LandingProductsSection
          sectionShell={sectionShell}
          h2={h2}
          onCountChange={setLiveProductCount}
        />

        <section id="about" className={sectionShell}>
          <div className="mx-auto max-w-3xl space-y-6">
            <h2 className={h2}>About us</h2>
            <p className="text-sm leading-relaxed text-zinc-400 sm:text-base">{COMPANY_STORY_INTRO}</p>
            <p className="text-sm leading-relaxed text-zinc-400 sm:text-base">{COMPANY_EXPANSION_NOTE}</p>
            <p className="text-sm leading-relaxed text-zinc-400 sm:text-base">{COMPANY_PHILGEPS_NOTE}</p>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Service coverage</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-zinc-400">
                {COMPANY_SERVICE_AREAS.map((area) => (
                  <li key={area}>{area}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="vision" className={sectionShell}>
          <div className="mx-auto max-w-3xl space-y-10">
            <div>
              <h2 className={h2}>Vision</h2>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">{COMPANY_VISION}</p>
            </div>
            <div>
              <h2 className={h2}>Mission</h2>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400 sm:text-base">{COMPANY_MISSION}</p>
            </div>
            <div>
              <h2 className={h2}>Our values</h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {COMPANY_VALUES.map((v) => (
                  <li
                    key={v}
                    className="rounded-sm border border-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300"
                  >
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="faq" className={sectionShell}>
          <div className="mx-auto max-w-3xl">
            <h2 className={h2}>FAQ</h2>
            <div className="mt-8 space-y-6 text-sm text-zinc-400">
              <div>
                <p className="font-bold uppercase tracking-wide text-white">Do you service fleet vehicles?</p>
                <p className="mt-2">
                  Yes. We serve private owners, commercial fleets, and institutional clients — contact us on Facebook
                  with your fleet size and preferred schedule.
                </p>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wide text-white">Where do you operate?</p>
                <p className="mt-2 text-zinc-400">Based in General Santos City, we serve customers across:</p>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  {COMPANY_SERVICE_AREAS.map((area) => (
                    <li key={area}>{area}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wide text-white">Are you a government supplier?</p>
                <p className="mt-2">{COMPANY_PHILGEPS_NOTE}</p>
              </div>
            </div>
          </div>
        </section>

        <LandingBookingSection />

        {/* Staff — dark panel, no POS link */}
        <section
          className="border-t border-white/10 bg-zinc-950 px-4 py-10 text-center sm:px-6"
          aria-label="Staff access"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-600">Authorized staff only</p>
          <p className="mx-auto mt-3 max-w-lg text-xs text-zinc-500">
            Operations console path (copy only; not linked):{' '}
            <span className="mt-2 block select-all break-all font-mono text-[11px] text-zinc-400">{staffUrlExample}</span>
          </p>
          <p className="mt-2 font-mono text-[10px] text-zinc-600">
            https://{PUBLIC_SITE_HOST}
            {OPS_APP_PATH}
          </p>
        </section>

        <footer className="border-t border-white/10 px-4 py-6 text-center text-[10px] uppercase tracking-wider text-zinc-600">
          © {new Date().getFullYear()} {COMPANY_DISPLAY_NAME} · {PUBLIC_SITE_HOST}
        </footer>
      </div>
    </div>
  );
};
