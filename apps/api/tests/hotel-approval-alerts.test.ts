// Pure-function tests for the three hotel-approval alert templates.
//
// Locks the rendered subject + body shape so a stray edit doesn't quietly
// change the wording the approver / booker sees in their inbox.

import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/services/alerts/templates/index.js';
import { channelsForEvent } from '../src/services/alerts/router.js';
import type { AlertPayload, HotelApprovalVars } from '../src/services/alerts/types.js';

const baseVars: HotelApprovalVars = {
  bookingId: '64a1b2c3d4e5f6a7b8c9d0e1',
  hotelName: 'Grand Hyatt Mumbai',
  city: 'Mumbai',
  checkIn: '2026-08-15',
  checkOut: '2026-08-17',
  nights: 2,
  totalSellingPaise: 12_000_00, // Rs 12,000
  reasons: ['TOTAL_OVER_APPROVAL_THRESHOLD'],
  bookerName: 'Alice Booker',
  detailUrl: 'https://b2b.tripbng.com/approvals/64a1b2c3d4e5f6a7b8c9d0e1',
  decidedBy: null,
  decisionNote: null,
};

describe('HOTEL_BOOKING_AWAITS_APPROVAL', () => {
  const payload: AlertPayload = { event: 'HOTEL_BOOKING_AWAITS_APPROVAL', vars: baseVars };

  it('email subject leads with hotel name + total', () => {
    const email = TEMPLATES.HOTEL_BOOKING_AWAITS_APPROVAL!.email!(payload);
    expect(email.subject).toContain('Grand Hyatt Mumbai');
    expect(email.subject).toContain('Rs 12,000');
  });

  it('email body cites the booker + reasons', () => {
    const email = TEMPLATES.HOTEL_BOOKING_AWAITS_APPROVAL!.email!(payload);
    expect(email.html).toContain('Alice Booker');
    expect(email.html).toContain('TOTAL_OVER_APPROVAL_THRESHOLD');
    expect(email.html).toContain('href="https://b2b.tripbng.com/approvals/');
    expect(email.html).toContain('No funds have been debited');
  });

  it('text version includes the review URL when set', () => {
    const email = TEMPLATES.HOTEL_BOOKING_AWAITS_APPROVAL!.email!(payload);
    expect(email.text).toContain('https://b2b.tripbng.com/approvals/');
  });

  it('inapp action url falls back to /approvals/:bookingId when detailUrl is null', () => {
    const inapp = TEMPLATES.HOTEL_BOOKING_AWAITS_APPROVAL!.inapp!({
      event: 'HOTEL_BOOKING_AWAITS_APPROVAL',
      vars: { ...baseVars, detailUrl: null },
    });
    expect(inapp.actionUrl).toBe('/approvals/64a1b2c3d4e5f6a7b8c9d0e1');
  });

  it('has no whatsapp template by design', () => {
    expect(TEMPLATES.HOTEL_BOOKING_AWAITS_APPROVAL!.whatsapp).toBeUndefined();
  });
});

describe('HOTEL_BOOKING_APPROVED', () => {
  const vars: HotelApprovalVars = {
    ...baseVars,
    decidedBy: 'Bob Manager',
    decisionNote: 'Approved — within Q3 travel budget.',
  };
  const payload: AlertPayload = { event: 'HOTEL_BOOKING_APPROVED', vars };

  it('email surfaces approver name + decision note', () => {
    const email = TEMPLATES.HOTEL_BOOKING_APPROVED!.email!(payload);
    expect(email.subject).toContain('Approved');
    expect(email.html).toContain('Bob Manager');
    expect(email.html).toContain('within Q3 travel budget');
  });

  it('whatsapp uses the right template name + 3 body params', () => {
    const wa = TEMPLATES.HOTEL_BOOKING_APPROVED!.whatsapp!(payload);
    expect(wa.templateName).toBe('hotel_booking_approved');
    expect(wa.bodyParams).toEqual(['Grand Hyatt Mumbai', '2026-08-15 – 2026-08-17', 'Bob Manager']);
  });

  it('falls back to "manager" when decidedBy is null', () => {
    const wa = TEMPLATES.HOTEL_BOOKING_APPROVED!.whatsapp!({
      ...payload,
      vars: { ...vars, decidedBy: null },
    });
    expect(wa.bodyParams[2]).toBe('manager');
  });
});

describe('HOTEL_BOOKING_REJECTED', () => {
  const vars: HotelApprovalVars = {
    ...baseVars,
    decidedBy: 'Bob Manager',
    decisionNote: 'Above approved hotel chain list — please use a Marriott property.',
  };
  const payload: AlertPayload = { event: 'HOTEL_BOOKING_REJECTED', vars };

  it('email subject is explicitly negative', () => {
    const email = TEMPLATES.HOTEL_BOOKING_REJECTED!.email!(payload);
    expect(email.subject).toContain('declined');
  });

  it('email body surfaces the rejection reason verbatim', () => {
    const email = TEMPLATES.HOTEL_BOOKING_REJECTED!.email!(payload);
    expect(email.html).toContain('Above approved hotel chain list');
    expect(email.html).toContain('No funds were debited');
  });

  it('falls back to "Not specified" when decisionNote is null', () => {
    const email = TEMPLATES.HOTEL_BOOKING_REJECTED!.email!({
      ...payload,
      vars: { ...vars, decisionNote: null },
    });
    expect(email.html).toContain('Not specified');
  });

  it('has no whatsapp — rejection is sensitive context, email-only', () => {
    expect(TEMPLATES.HOTEL_BOOKING_REJECTED!.whatsapp).toBeUndefined();
  });
});

describe('router channel matrix for hotel approval events', () => {
  it('AWAITS_APPROVAL = email + inapp', () => {
    expect(channelsForEvent('HOTEL_BOOKING_AWAITS_APPROVAL')).toEqual(['email', 'inapp']);
  });

  it('APPROVED = email + whatsapp + inapp', () => {
    expect(channelsForEvent('HOTEL_BOOKING_APPROVED')).toEqual(['email', 'whatsapp', 'inapp']);
  });

  it('REJECTED = email + inapp (no whatsapp by design)', () => {
    expect(channelsForEvent('HOTEL_BOOKING_REJECTED')).toEqual(['email', 'inapp']);
  });
});
