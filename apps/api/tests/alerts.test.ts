// Pure-function tests for the alert template system. No I/O, no Mongo, no
// network — verifies the rendered output of every P0 template matches the
// shape the channel adapters expect (subject + html + text for SMTP,
// templateName + bodyParams for WhatsApp, title + body for in-app).

import { describe, expect, it } from 'vitest';
import type { NotificationPrefs } from '@tripbng/shared';
import { TEMPLATES } from '../src/services/alerts/templates/index.js';
import type { AlertPayload } from '../src/services/alerts/types.js';
import { rs } from '../src/services/alerts/types.js';
import {
  applyRecipientPrefs,
  channelsForEvent,
  isUserConfigurableEvent,
} from '../src/services/alerts/router.js';

describe('alert templates / P0 rendering', () => {
  describe('BOOKING_CONFIRMED', () => {
    const payload: AlertPayload = {
      event: 'BOOKING_CONFIRMED',
      vars: {
        bookingCode: 'TR-1234',
        pnr: 'ABCDE1',
        sector: 'BLR-DEL',
        travelDate: '2026-06-15',
        paxCount: 2,
        amountPaise: 8_45_00, // ₹845
        ticketUrl: 'https://api.tripbng.com/api/v1/bookings/abc/ticket?sig=xx&exp=1',
      },
    };

    it('renders email with booking code in subject and amount in body', () => {
      const t = TEMPLATES.BOOKING_CONFIRMED!;
      const email = t.email!(payload);
      expect(email.subject).toContain('TR-1234');
      expect(email.subject).toContain('BLR-DEL');
      expect(email.html).toContain('TR-1234');
      expect(email.html).toContain('ABCDE1');
      expect(email.html).toContain('Rs 845');
      expect(email.html).toContain('href="https://api.tripbng.com');
      expect(email.text).toContain('TR-1234');
      expect(email.text).toContain('Rs 845');
    });

    it('renders whatsapp with all 5 positional body params', () => {
      const t = TEMPLATES.BOOKING_CONFIRMED!;
      const wa = t.whatsapp!(payload);
      expect(wa.templateName).toBe('booking_confirmed');
      expect(wa.bodyParams).toHaveLength(5);
      expect(wa.bodyParams[0]).toBe('TR-1234');
      expect(wa.bodyParams[1]).toBe('BLR-DEL');
      expect(wa.bodyParams[3]).toBe('Rs 845');
    });

    it('renders inapp with action url pointing at ticket', () => {
      const t = TEMPLATES.BOOKING_CONFIRMED!;
      const inapp = t.inapp!(payload);
      expect(inapp.title).toContain('TR-1234');
      expect(inapp.actionUrl).toContain('/bookings/abc/ticket');
    });
  });

  describe('BOOKING_FAILED', () => {
    const payload: AlertPayload = {
      event: 'BOOKING_FAILED',
      vars: {
        bookingCode: 'TR-5678',
        pnr: null,
        sector: 'DEL-MAA',
        travelDate: '2026-07-01',
        paxCount: 1,
        amountPaise: 5_00_00,
        ticketUrl: null,
        failureReason: 'supplier returned non-2xx',
      },
    };

    it('email surfaces refund language and the failure reason', () => {
      const email = TEMPLATES.BOOKING_FAILED!.email!(payload);
      expect(email.subject).toContain('failed');
      expect(email.html).toContain('refunded');
      expect(email.html).toContain('supplier returned non-2xx');
    });

    it('whatsapp truncates the failure reason to 200 chars', () => {
      const longReason = 'x'.repeat(500);
      const wa = TEMPLATES.BOOKING_FAILED!.whatsapp!({
        ...payload,
        vars: { ...payload.vars, failureReason: longReason },
      });
      expect(wa.bodyParams[3]?.length).toBeLessThanOrEqual(200);
    });
  });

  describe('TOPUP_SUCCEEDED', () => {
    const payload: AlertPayload = {
      event: 'TOPUP_SUCCEEDED',
      vars: {
        txnCode: 'PT-99',
        amountPaise: 10_00_00,
        provider: 'PHONEPE',
        walletBalancePaise: 50_00_00,
      },
    };

    it('all three channels present', () => {
      const t = TEMPLATES.TOPUP_SUCCEEDED!;
      expect(t.email).toBeDefined();
      expect(t.whatsapp).toBeDefined();
      expect(t.inapp).toBeDefined();
    });

    it('shows balance when present', () => {
      const email = TEMPLATES.TOPUP_SUCCEEDED!.email!(payload);
      expect(email.html).toContain('Rs 5,000');
    });

    it('falls back to em-dash when balance is null', () => {
      const noBalance = {
        ...payload,
        vars: { ...payload.vars, walletBalancePaise: null },
      };
      const wa = TEMPLATES.TOPUP_SUCCEEDED!.whatsapp!(noBalance);
      expect(wa.bodyParams[2]).toBe('—');
    });
  });

  describe('TOPUP_FAILED', () => {
    it('has email + inapp but NOT whatsapp by design', () => {
      const t = TEMPLATES.TOPUP_FAILED!;
      expect(t.email).toBeDefined();
      expect(t.inapp).toBeDefined();
      expect(t.whatsapp).toBeUndefined();
    });
  });

  describe('HOLD_EXPIRY_WARNING', () => {
    const payload: AlertPayload = {
      event: 'HOLD_EXPIRY_WARNING',
      vars: {
        bookingCode: 'TR-9999',
        sector: 'BOM-COK',
        expiresAt: '2026-05-04T10:00:00.000Z',
        minutesRemaining: 5,
      },
    };

    it('subject has the urgency lead-time', () => {
      const email = TEMPLATES.HOLD_EXPIRY_WARNING!.email!(payload);
      expect(email.subject).toContain('5 min');
    });

    it('whatsapp template uses the right name', () => {
      const wa = TEMPLATES.HOLD_EXPIRY_WARNING!.whatsapp!(payload);
      expect(wa.templateName).toBe('hold_expiry_warning');
      expect(wa.bodyParams).toEqual(['TR-9999', 'BOM-COK', '5']);
    });
  });
});

describe('alert templates / P1 + P2 rendering', () => {
  describe('BOOKING_CANCELLED', () => {
    const payload: AlertPayload = {
      event: 'BOOKING_CANCELLED',
      vars: {
        bookingCode: 'TR-7777',
        pnr: 'XYZ123',
        sector: 'BLR-AMS',
        travelDate: '2026-12-01',
        paxCount: 2,
        amountPaise: 50_000_00,
        ticketUrl: null,
        refundPaise: 45_000_00,
        cancellationFeePaise: 5_000_00,
      },
    };

    it('subject leads with the net refund amount', () => {
      const email = TEMPLATES.BOOKING_CANCELLED!.email!(payload);
      // refund 45k - fee 5k = net 40k
      expect(email.subject).toContain('Rs 40,000');
    });

    it('whatsapp shows cancellation fee + net refund as separate params', () => {
      const wa = TEMPLATES.BOOKING_CANCELLED!.whatsapp!(payload);
      expect(wa.bodyParams).toEqual(['TR-7777', 'BLR-AMS', 'Rs 5,000', 'Rs 40,000']);
    });

    it('renders "None" when there is no cancellation fee', () => {
      const noFee = {
        ...payload,
        vars: { ...payload.vars, cancellationFeePaise: 0 },
      };
      const email = TEMPLATES.BOOKING_CANCELLED!.email!(noFee);
      expect(email.html).toContain('None');
      const wa = TEMPLATES.BOOKING_CANCELLED!.whatsapp!(noFee);
      expect(wa.bodyParams[2]).toBe('None');
    });
  });

  describe('LOW_WALLET_BALANCE', () => {
    const payload: AlertPayload = {
      event: 'LOW_WALLET_BALANCE',
      vars: {
        walletBalancePaise: 50_00, // Rs 50
        thresholdPaise: 100_00, // Rs 100
        topupUrl: 'https://api.tripbng.com/wallet/topup',
      },
    };

    it('subject and body include both balance and threshold', () => {
      const email = TEMPLATES.LOW_WALLET_BALANCE!.email!(payload);
      expect(email.subject).toContain('Rs 50');
      expect(email.html).toContain('Rs 100');
      expect(email.html).toContain('href="https://api.tripbng.com/wallet/topup"');
    });

    it('whatsapp passes 3 positional params in order', () => {
      const wa = TEMPLATES.LOW_WALLET_BALANCE!.whatsapp!(payload);
      expect(wa.templateName).toBe('low_wallet_balance');
      expect(wa.bodyParams).toEqual(['Rs 50', 'Rs 100', 'https://api.tripbng.com/wallet/topup']);
    });
  });

  describe('INSURANCE_ISSUED', () => {
    const payload: AlertPayload = {
      event: 'INSURANCE_ISSUED',
      vars: {
        policyNumbers: ['POL-1', 'POL-2'],
        insurerName: 'Acme Insurance',
        premiumPaise: 2_500_00,
        bookingCode: 'TR-1',
      },
    };

    it('email lists every policy number', () => {
      const email = TEMPLATES.INSURANCE_ISSUED!.email!(payload);
      expect(email.html).toContain('POL-1');
      expect(email.html).toContain('POL-2');
      expect(email.subject).toContain('2 policies');
    });

    it('handles single-policy correctly (no plural-S)', () => {
      const single = {
        ...payload,
        vars: { ...payload.vars, policyNumbers: ['POL-ONE'] },
      };
      const email = TEMPLATES.INSURANCE_ISSUED!.email!(single);
      expect(email.subject).toContain('1 policy');
      expect(email.subject).not.toContain('1 policies');
    });

    it('has no whatsapp template (paperwork-only)', () => {
      expect(TEMPLATES.INSURANCE_ISSUED!.whatsapp).toBeUndefined();
    });
  });

  describe('MANUAL_TOPUP_APPROVED', () => {
    const payload: AlertPayload = {
      event: 'MANUAL_TOPUP_APPROVED',
      vars: {
        txnCode: 'MAN-99',
        amountPaise: 10_000_00,
        decidedBy: 'Distributor Bob',
      },
    };
    it('credits the right name in the email body', () => {
      const email = TEMPLATES.MANUAL_TOPUP_APPROVED!.email!(payload);
      expect(email.html).toContain('Distributor Bob');
      expect(email.html).toContain('Rs 10,000');
    });
  });

  describe('MANUAL_TOPUP_REJECTED', () => {
    const payload: AlertPayload = {
      event: 'MANUAL_TOPUP_REJECTED',
      vars: {
        txnCode: 'MAN-99',
        amountPaise: 10_000_00,
        decidedBy: 'Distributor Bob',
        rejectionReason: 'Bank statement upload missing',
      },
    };
    it('surfaces the rejection reason in subject + body', () => {
      const email = TEMPLATES.MANUAL_TOPUP_REJECTED!.email!(payload);
      expect(email.subject).toContain('rejected');
      expect(email.html).toContain('Bank statement upload missing');
    });

    it('falls back to "not specified" when reason is null', () => {
      const noReason = {
        ...payload,
        vars: { ...payload.vars, rejectionReason: null },
      };
      const email = TEMPLATES.MANUAL_TOPUP_REJECTED!.email!(noReason);
      expect(email.html).toContain('Not specified');
    });
  });

  describe('CIRCUIT_BREAKER_TRIPPED', () => {
    const payload: AlertPayload = {
      event: 'CIRCUIT_BREAKER_TRIPPED',
      vars: {
        supplier: 'ETRAV',
        errorRate: 0.42,
        windowSec: 60,
      },
    };
    it('formats the error rate as a percent', () => {
      const email = TEMPLATES.CIRCUIT_BREAKER_TRIPPED!.email!(payload);
      expect(email.subject).toContain('ETRAV');
      expect(email.html).toContain('42.0%');
    });

    it('has no whatsapp / inapp (ops-only)', () => {
      expect(TEMPLATES.CIRCUIT_BREAKER_TRIPPED!.whatsapp).toBeUndefined();
      expect(TEMPLATES.CIRCUIT_BREAKER_TRIPPED!.inapp).toBeUndefined();
    });
  });

  describe('LOGIN_NEW_DEVICE', () => {
    const payload: AlertPayload = {
      event: 'LOGIN_NEW_DEVICE',
      vars: {
        ipAddress: '203.0.113.42',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        at: '2026-05-04T12:34:56.000Z',
      },
    };
    it('surfaces the IP + truncated user-agent', () => {
      const email = TEMPLATES.LOGIN_NEW_DEVICE!.email!(payload);
      expect(email.html).toContain('203.0.113.42');
      expect(email.html).toContain('Mozilla/5.0');
    });

    it('truncates long user-agents to 80 chars in display', () => {
      const longUa = 'A'.repeat(500);
      const email = TEMPLATES.LOGIN_NEW_DEVICE!.email!({
        ...payload,
        vars: { ...payload.vars, userAgent: longUa },
      });
      // The full unstripped HTML obviously contains many A's, but the
      // truncated value (max 80 chars) should appear.
      expect(email.html).toMatch(/A{79}…/);
    });

    it('email-only — no other channels (security signal goes to inbox)', () => {
      expect(TEMPLATES.LOGIN_NEW_DEVICE!.whatsapp).toBeUndefined();
      expect(TEMPLATES.LOGIN_NEW_DEVICE!.inapp).toBeUndefined();
    });
  });
});

describe('alert router / channel matrix', () => {
  it('BOOKING_CONFIRMED uses all three channels by default', () => {
    expect(channelsForEvent('BOOKING_CONFIRMED')).toEqual(['email', 'whatsapp', 'inapp']);
  });

  it('TOPUP_FAILED skips whatsapp by default (template-fatigue avoidance)', () => {
    expect(channelsForEvent('TOPUP_FAILED')).toEqual(['email', 'inapp']);
  });

  it('HOLD_EXPIRY_WARNING is whatsapp-first (email is too slow)', () => {
    expect(channelsForEvent('HOLD_EXPIRY_WARNING')).toEqual(['whatsapp', 'inapp']);
  });

  it('CIRCUIT_BREAKER_TRIPPED is email-only (ops inbox)', () => {
    expect(channelsForEvent('CIRCUIT_BREAKER_TRIPPED')).toEqual(['email']);
  });

  it('explicit override beats the default', () => {
    expect(channelsForEvent('BOOKING_CONFIRMED', ['email'])).toEqual(['email']);
  });

  it('empty override falls back to default', () => {
    expect(channelsForEvent('BOOKING_CONFIRMED', [])).toEqual(['email', 'whatsapp', 'inapp']);
  });
});

describe('rs() formatter', () => {
  it('formats whole rupees without decimals', () => {
    expect(rs(50_00)).toBe('Rs 50');
  });

  it('keeps fractional rupees', () => {
    expect(rs(150_50)).toBe('Rs 150.5');
  });

  it('groups large amounts with commas', () => {
    // Don't assert exact comma placement — Node without full-icu falls back
    // to en-US grouping (1,00,000 vs 100,000). Both are acceptable; just
    // verify the prefix and the digits are intact.
    const out = rs(100_000_00); // 100,000 rupees = 10 million paise
    expect(out).toMatch(/^Rs [\d,]+$/);
    expect(out.replace(/[^0-9]/g, '')).toBe('100000');
  });
});

describe('applyRecipientPrefs / per-agency channel filtering', () => {
  const allChannelsOn: NotificationPrefs = {
    channels: { email: true, whatsapp: true, inapp: true },
    events: {},
    lowBalanceThresholdPaise: null,
  };

  it('returns base channels when prefs are null', () => {
    expect(applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_CONFIRMED', null)).toEqual([
      'email',
      'whatsapp',
      'inapp',
    ]);
  });

  it('returns base channels when prefs match defaults', () => {
    expect(
      applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_CONFIRMED', allChannelsOn),
    ).toEqual(['email', 'whatsapp', 'inapp']);
  });

  it('master switch removes a single channel', () => {
    const noWA: NotificationPrefs = {
      ...allChannelsOn,
      channels: { ...allChannelsOn.channels, whatsapp: false },
    };
    expect(applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_CONFIRMED', noWA)).toEqual([
      'email',
      'inapp',
    ]);
  });

  it('event-level override replaces base channels then master switches still apply', () => {
    const overrideOnly: NotificationPrefs = {
      ...allChannelsOn,
      events: { BOOKING_CONFIRMED: ['email'] },
    };
    expect(
      applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_CONFIRMED', overrideOnly),
    ).toEqual(['email']);

    // Now turn email OFF master-side — overrides shouldn't survive that.
    const overrideButEmailOff: NotificationPrefs = {
      ...allChannelsOn,
      channels: { ...allChannelsOn.channels, email: false },
      events: { BOOKING_CONFIRMED: ['email'] },
    };
    expect(
      applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_CONFIRMED', overrideButEmailOff),
    ).toEqual([]);
  });

  it('different events use different overrides on the same agency', () => {
    const prefs: NotificationPrefs = {
      ...allChannelsOn,
      events: {
        BOOKING_CONFIRMED: ['email'],
        TOPUP_SUCCEEDED: ['whatsapp', 'inapp'],
      },
    };
    expect(
      applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_CONFIRMED', prefs),
    ).toEqual(['email']);
    expect(
      applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'TOPUP_SUCCEEDED', prefs),
    ).toEqual(['whatsapp', 'inapp']);
  });

  it('events not in the override map fall back to base channels', () => {
    const onlyOneEvent: NotificationPrefs = {
      ...allChannelsOn,
      events: { BOOKING_CONFIRMED: ['email'] },
    };
    // BOOKING_FAILED has no override — should use base channels unchanged
    expect(
      applyRecipientPrefs(['email', 'whatsapp', 'inapp'], 'BOOKING_FAILED', onlyOneEvent),
    ).toEqual(['email', 'whatsapp', 'inapp']);
  });

  it('CIRCUIT_BREAKER_TRIPPED bypasses prefs entirely (ops-only)', () => {
    const allOff: NotificationPrefs = {
      channels: { email: false, whatsapp: false, inapp: false },
      events: {},
      lowBalanceThresholdPaise: null,
    };
    expect(applyRecipientPrefs(['email'], 'CIRCUIT_BREAKER_TRIPPED', allOff)).toEqual(['email']);
  });

  it('isUserConfigurableEvent excludes security/ops events', () => {
    expect(isUserConfigurableEvent('BOOKING_CONFIRMED')).toBe(true);
    expect(isUserConfigurableEvent('TOPUP_SUCCEEDED')).toBe(true);
    expect(isUserConfigurableEvent('PASSWORD_RESET_OTP')).toBe(false);
    expect(isUserConfigurableEvent('CIRCUIT_BREAKER_TRIPPED')).toBe(false);
  });
});
