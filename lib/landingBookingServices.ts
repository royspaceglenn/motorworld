import { COMPANY_SERVICES } from './company';

/** Booking form options derived from the official service list. */
export const LANDING_BOOKING_SERVICE_OPTIONS = [
  { value: '', label: 'Select service *' },
  ...COMPANY_SERVICES.map((label) => ({
    value: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    label,
  })),
  { value: 'products', label: 'Products (tires, lubricants, batteries, filters)' },
  { value: 'fleet', label: 'Fleet / institutional inquiry' },
  { value: 'other', label: 'Other' },
] as const;
