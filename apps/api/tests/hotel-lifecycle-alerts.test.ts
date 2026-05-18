// Pure-function tests for the three hotel-lifecycle alert templates
// (CONFIRMED, FAILED, CANCELLED). Locks subject + body + WhatsApp param
// shape so a stray edit doesn't quietly change what the booker sees.

import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/services/alerts/templates/index.js';
import { channelsForEvent } from '../src/services/alerts/router.js';
import type { AlertPayload, HotelLifecycleVars } from '../src/services/alerts/types.js';

const baseVars: HotelLifecycleVars = {
  bookingId: '64a1b2c3d4e5f6a7b8c9d0e1',
  bookingCode: 'TRBNG-HTL-2026-000123',
  hotelName: 'Grand Hyatt Mumbai',
  city: 'Mumbai',
  checkIn: '2026-08-15',
  checkOut: '2026-08-17',
  nights: 2,
  totalSellingPaise: 12_000_00, // Rs 12,000
  confirmationNo: 'TBO-CONF-9876',
  invoiceNumber: 'INV-2026-0042',
  detailUrl: 'https://b2b.tripbng.com/bookings/64a1b2c3d4e5f6a7b8c9d0e1',
};

describe('HOTEL_BOOKING_CONFIRMED', () => {
  const payload: AlertPayload = { event: 'HOTEL_BOOKING_CONFIRMED', vars: baseVars };

  it('email subject includes hotel name + check-in date', () => {
    const email = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.email!(payload);
    expect(email.subject).toContain('Grand Hyatt Mumbai');
    expect(email.subject).toContain('2026-08-15');
  });

  it('email body shows confirmation number + total paid + CTA link', () => {
    const email = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.email!(payload);
    expect(email.html).toContain('TBO-CONF-9876');
    expect(email.html).toContain('Rs 12,000');
    expect(email.html).toContain('href="https://b2b.tripbng.com/bookings/');
  });

  it('text version is plain-text-renderable for inbox previews', () => {
    const email = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.email!(payload);
    expect(email.text).toContain('Booking confirmed');
    expect(email.text).toContain('Grand Hyatt Mumbai');
    expect(email.text).toContain('TBO-CONF-9876');
  });

  it('singularises "1 night" correctly', () => {
    const email = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.email!({
      event: 'HOTEL_BOOKING_CONFIRMED',
      vars: { ...baseVars, nights: 1 },
    });
    expect(email.html).toContain('1 night');
    expect(email.html).not.toContain('1 nights');
  });

  it('whatsapp template uses 4 positional params in the right order', () => {
    const wa = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.whatsapp!(payload);
    expect(wa.templateName).toBe('hotel_booking_confirmed');
    expect(wa.bodyParams).toEqual([
      'Grand Hyatt Mumbai',
      '2026-08-15 – 2026-08-17',
      'TBO-CONF-9876',
      'Rs 12,000',
    ]);
  });

  it('falls back to em-dash when confirmationNo is null', () => {
    const wa = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.whatsapp!({
      event: 'HOTEL_BOOKING_CONFIRMED',
      vars: { ...baseVars, confirmationNo: null },
    });
    expect(wa.bodyParams[2]).toBe('—');
  });

  it('inapp action url falls back to /bookings/:id when detailUrl is null', () => {
    const inapp = TEMPLATES.HOTEL_BOOKING_CONFIRMED!.inapp!({
      event: 'HOTEL_BOOKING_CONFIRMED',
      vars: { ...baseVars, detailUrl: null },
    });
    expect(inapp.actionUrl).toBe('/bookings/64a1b2c3d4e5f6a7b8c9d0e1');
  });
});

describe('HOTEL_BOOKING_FAILED', () => {
  const payload: AlertPayload = {
    event: 'HOTEL_BOOKING_FAILED',
    vars: { ...baseVars, failureReason: 'Supplier returned 503 after 3 retries' },
  };

  it('email subject signals failure + refund', () => {
    const email = TEMPLATES.HOTEL_BOOKING_FAILED!.email!(payload);
    expect(email.subject).toContain('failed');
    expect(email.subject).toContain('refund');
  });

  it('email body cites the failure reason verbatim + amount refunded', () => {
    const email = TEMPLATES.HOTEL_BOOKING_FAILED!.email!(payload);
    expect(email.html).toContain('Supplier returned 503 after 3 retries');
    expect(email.html).toContain('Rs 12,000');
    expect(email.html).toContain('refunded');
  });

  it('falls back to a generic message when failureReason is null', () => {
    const email = TEMPLATES.HOTEL_BOOKING_FAILED!.email!({
      event: 'HOTEL_BOOKING_FAILED',
      vars: { ...baseVars, failureReason: null },
    });
    expect(email.html).toContain('Supplier did not return a confirmation');
  });

  it('has no whatsapp template by design (sensitive context)', () => {
    expect(TEMPLATES.HOTEL_BOOKING_FAILED!.whatsapp).toBeUndefined();
  });
});

describe('HOTEL_BOOKING_CANCELLED', () => {
  const payload: AlertPayload = {
    event: 'HOTEL_BOOKING_CANCELLED',
    vars: { ...baseVars, refundPaise: 10_000_00, cancellationFeePaise: 2_000_00 },
  };

  it('email subject leads with the net refund amount', () => {
    const email = TEMPLATES.HOTEL_BOOKING_CANCELLED!.email!(payload);
    // refund 10k - fee 2k = net 8k
    expect(email.subject).toContain('Rs 8,000');
    expect(email.subject).toContain('Cancellation processed');
  });

  it('email body breaks out original total + fee + net refund', () => {
    const email = TEMPLATES.HOTEL_BOOKING_CANCELLED!.email!(payload);
    expect(email.html).toContain('Rs 12,000'); // original
    expect(email.html).toContain('Rs 2,000'); // fee
    expect(email.html).toContain('Rs 10,000'); // refund
    expect(email.html).toContain('Rs 8,000'); // net
  });

  it('whatsapp template uses 4 positional params', () => {
    const wa = TEMPLATES.HOTEL_BOOKING_CANCELLED!.whatsapp!(payload);
    expect(wa.templateName).toBe('hotel_booking_cancelled');
    expect(wa.bodyParams).toEqual([
      'Grand Hyatt Mumbai',
      '2026-08-15 – 2026-08-17',
      'Rs 2,000',
      'Rs 8,000',
    ]);
  });

  it('renders "None" when there is no cancellation fee', () => {
    const noFee = {
      event: 'HOTEL_BOOKING_CANCELLED' as const,
      vars: { ...baseVars, refundPaise: 12_000_00, cancellationFeePaise: 0 },
    };
    const email = TEMPLATES.HOTEL_BOOKING_CANCELLED!.email!(noFee);
    expect(email.html).toContain('None');
    const wa = TEMPLATES.HOTEL_BOOKING_CANCELLED!.whatsapp!(noFee);
    expect(wa.bodyParams[2]).toBe('None');
  });

  it('inapp body summarises the credit + fee', () => {
    const inapp = TEMPLATES.HOTEL_BOOKING_CANCELLED!.inapp!(payload);
    expect(inapp.body).toContain('Rs 8,000');
    expect(inapp.body).toContain('Rs 2,000');
  });
});

describe('router channel matrix for hotel lifecycle events', () => {
  it('CONFIRMED = email + whatsapp + inapp', () => {
    expect(channelsForEvent('HOTEL_BOOKING_CONFIRMED')).toEqual(['email', 'whatsapp', 'inapp']);
  });

  it('FAILED = email + inapp (no whatsapp)', () => {
    expect(channelsForEvent('HOTEL_BOOKING_FAILED')).toEqual(['email', 'inapp']);
  });

  it('CANCELLED = email + whatsapp + inapp', () => {
    expect(channelsForEvent('HOTEL_BOOKING_CANCELLED')).toEqual(['email', 'whatsapp', 'inapp']);
  });
});
