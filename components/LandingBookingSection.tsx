import React, { useCallback, useState } from 'react';
import {
  BOOKING_ADDRESS_LINES,
  BOOKING_EMAIL,
  BOOKING_HOURS,
  BOOKING_PHONE_PRIMARY,
  BOOKING_PHONE_SECONDARY,
  FACEBOOK_BUSINESS_PAGE_URL,
  INSTAGRAM_PAGE_URL,
  TIKTOK_PAGE_URL,
} from '../lib/company';
import { LANDING_BOOKING_SERVICE_OPTIONS } from '../lib/landingBookingServices';
import { submitMotorWorldOnlineBooking } from '../lib/publicBookings';
import { MapPin, Phone, Mail, Clock, Facebook, Instagram } from 'lucide-react';

const RED = '#E31837';
const LABEL = '#c45c4a';

function ContactRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-900/80 text-zinc-300">
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{label}</p>
        <div className="mt-1 text-sm leading-relaxed text-zinc-200">{children}</div>
      </div>
    </div>
  );
}

export function LandingBookingSection() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [service, setService] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setSuccess('');
      if (!fullName.trim() || !phone.trim() || !email.trim() || !service) {
        setError('Please fill in name, phone, email, and service.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Please enter a valid email address.');
        return;
      }
      const serviceLabel =
        LANDING_BOOKING_SERVICE_OPTIONS.find((o) => o.value === service)?.label || service;
      setSubmitting(true);
      try {
        const result = await submitMotorWorldOnlineBooking({
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          serviceKey: service,
          serviceLabel,
          preferredDate: preferredDate || undefined,
          vehicleDescription: vehicle.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        setSuccess(
          result.message ||
            'Booking received! Our team will confirm your schedule and contact you soon.'
        );
        setFullName('');
        setPhone('');
        setEmail('');
        setService('');
        setPreferredDate('');
        setVehicle('');
        setNotes('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not submit booking. Try again or message us on Facebook.');
      } finally {
        setSubmitting(false);
      }
    },
    [email, fullName, notes, phone, preferredDate, service, vehicle],
  );

  const socialBtn =
    'flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-zinc-900/80 text-zinc-300 transition hover:border-white/30 hover:bg-zinc-800 hover:text-white';

  return (
    <section id="booking" className="scroll-mt-24 border-t border-white/10 bg-black/50 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-16 lg:items-start">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.35em]" style={{ color: LABEL }}>
            — 05 — Book
          </p>
          <h2 className="mt-4 text-3xl font-black uppercase leading-[1.08] tracking-tight text-white sm:text-4xl lg:text-5xl">
            Drop the keys.{' '}
            <span style={{ color: RED }}>We&apos;ll handle the rest.</span>
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-zinc-400 sm:text-base">
            Tell us what you drive and what you need — we confirm availability, prep the bay, and walk you through
            options before any wrench turns.
          </p>

          <div className="mt-10 space-y-8">
            <ContactRow label="Visit us" icon={<MapPin className="h-5 w-5" aria-hidden />}>
              {BOOKING_ADDRESS_LINES.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </ContactRow>
            <ContactRow label="Call / text" icon={<Phone className="h-5 w-5" aria-hidden />}>
              <div>{BOOKING_PHONE_PRIMARY}</div>
              <div className="text-zinc-400">{BOOKING_PHONE_SECONDARY}</div>
            </ContactRow>
            <ContactRow label="Email" icon={<Mail className="h-5 w-5" aria-hidden />}>
              <a href={`mailto:${BOOKING_EMAIL}`} className="text-white underline-offset-2 hover:underline">
                {BOOKING_EMAIL}
              </a>
            </ContactRow>
            <ContactRow label="Hours" icon={<Clock className="h-5 w-5" aria-hidden />}>
              {BOOKING_HOURS}
            </ContactRow>
          </div>

          <div className="mt-12">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500">Follow the garage</p>
            <div className="mt-4 flex gap-3">
              <a
                href={FACEBOOK_BUSINESS_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={socialBtn}
                aria-label="Facebook"
              >
                <Facebook className="h-5 w-5" aria-hidden />
              </a>
              <a
                href={INSTAGRAM_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={socialBtn}
                aria-label="Instagram"
              >
                <Instagram className="h-5 w-5" aria-hidden />
              </a>
              <a
                href={TIKTOK_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={socialBtn}
                aria-label="TikTok"
              >
                <span className="text-[10px] font-black tracking-tight">TT</span>
              </a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-zinc-950/90 p-6 shadow-2xl shadow-black/40 sm:p-8">
          <h3 className="text-xl font-black uppercase tracking-tight text-white sm:text-2xl">Book a service</h3>
          <p className="mt-2 text-sm text-zinc-500">
            We&apos;ll respond within 15 minutes during business hours (Facebook is fastest).
          </p>

          <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
            {error ? (
              <div className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-emerald-600/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
                {success}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="sr-only" htmlFor="bk-name">
                  Full name
                </label>
                <input
                  id="bk-name"
                  className="w-full rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none ring-0 placeholder:text-zinc-500 focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40"
                  placeholder="Full name *"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="sr-only" htmlFor="bk-phone">
                  Phone
                </label>
                <input
                  id="bk-phone"
                  className="w-full rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40"
                  placeholder="Phone *"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
            </div>

            <div>
              <label className="sr-only" htmlFor="bk-email">
                Email
              </label>
              <input
                id="bk-email"
                type="email"
                className="w-full rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40"
                placeholder="Email *"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="sr-only" htmlFor="bk-service">
                  Service
                </label>
                <select
                  id="bk-service"
                  className="w-full appearance-none rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                >
                  {LANDING_BOOKING_SERVICE_OPTIONS.map((o) => (
                    <option key={o.value || '_placeholder'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="sr-only" htmlFor="bk-date">
                  Preferred date
                </label>
                <input
                  id="bk-date"
                  type="date"
                  className="w-full rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40 [color-scheme:dark]"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="sr-only" htmlFor="bk-vehicle">
                Vehicle
              </label>
              <input
                id="bk-vehicle"
                className="w-full rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40"
                placeholder="Vehicle (make · model · year)"
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
              />
            </div>

            <div>
              <label className="sr-only" htmlFor="bk-notes">
                Notes
              </label>
              <textarea
                id="bk-notes"
                rows={4}
                className="w-full resize-y rounded-md border border-white/15 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-red-600/60 focus:ring-1 focus:ring-red-600/40"
                placeholder="Describe the issue or what you need checked…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-sm py-3.5 text-xs font-black uppercase tracking-[0.15em] text-white shadow-lg transition hover:opacity-95 disabled:opacity-60"
              style={{ backgroundColor: RED }}
            >
              {submitting ? 'Sending…' : 'Request booking'}
            </button>
            <p className="text-center text-[10px] text-zinc-600">
              Submitted online to our team — or message us on{' '}
              <a href={FACEBOOK_BUSINESS_PAGE_URL} className="text-zinc-400 underline hover:text-white" target="_blank" rel="noopener noreferrer">
                Facebook
              </a>{' '}
              for the fastest reply.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
