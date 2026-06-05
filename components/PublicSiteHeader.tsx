import React from 'react';
import { Wrench } from 'lucide-react';

const RED = '#E31837';

type PublicNavPage = 'home' | 'products';

interface PublicSiteHeaderProps {
  active?: PublicNavPage;
}

export const PublicSiteHeader: React.FC<PublicSiteHeaderProps> = ({ active = 'home' }) => {
  const navItem = (page: PublicNavPage | 'section', href: string, label: string) => {
    const isActive = page === active;
    return (
      <a
        className={`text-[11px] font-semibold uppercase tracking-[0.2em] transition sm:text-xs ${
          isActive ? 'text-white' : 'text-zinc-400 hover:text-white'
        }`}
        href={href}
        aria-current={isActive ? 'page' : undefined}
      >
        {label}
      </a>
    );
  };

  const sectionLink = (href: string, label: string) => (
    <a
      className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400 transition hover:text-white sm:text-xs"
      href={href}
    >
      {label}
    </a>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <a href="/" className="flex shrink-0 items-center gap-2 text-white" aria-label="Motor World home">
          <Wrench className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: RED }} aria-hidden />
          <span className="text-sm font-black uppercase tracking-[0.18em] sm:text-base">Motorworld</span>
        </a>

        <nav className="hidden flex-1 justify-center gap-6 md:flex lg:gap-10" aria-label="Primary">
          {sectionLink('/#services', 'Services')}
          {navItem('products', '/products', 'Products')}
          {sectionLink('/#about', 'About')}
          {sectionLink('/#vision', 'Vision')}
          {sectionLink('/#faq', 'FAQ')}
        </nav>

        <a
          href="/#booking"
          className="shrink-0 rounded-sm px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-lg transition hover:opacity-95 sm:px-5 sm:text-xs"
          style={{ backgroundColor: RED }}
        >
          Book service
        </a>
      </div>
      <div className="flex justify-center gap-4 overflow-x-auto border-t border-white/5 px-4 py-2 md:hidden">
        {sectionLink('/#services', 'Services')}
        {navItem('products', '/products', 'Products')}
        {sectionLink('/#about', 'About')}
        {sectionLink('/#vision', 'Vision')}
        {sectionLink('/#faq', 'FAQ')}
      </div>
    </header>
  );
};
