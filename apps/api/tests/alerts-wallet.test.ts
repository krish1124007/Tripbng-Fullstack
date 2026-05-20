// Pure-function tests for the Phase-9 wallet alert templates. Mirrors the
// alerts.test.ts style — verifies email subject/body, whatsapp template name
// + body params, and in-app title/body for each of the 8 new events.

import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/services/alerts/templates/index.js';
import { channelsForEvent } from '../src/services/alerts/router.js';
import type { AlertPayload } from '../src/services/alerts/types.js';

describe('alert templates / Phase-9 wallet rendering', () => {
  describe('CREDIT_DUE — anchors (T-3 / T-1 / T+0 / T+3)', () => {
    const baseVars = {
      creditUsedPaise: 50_000_00,
      creditLimitPaise: 100_000_00,
      dueDate: '2026-07-15T00:00:00.000Z',
      offsetDays: 0,
      payNowUrl: 'https://tripbng.in/wallet/credit',
    };

    it('T-3 email subject is the heads-up phrasing', () => {
      const payload: AlertPayload = {
        event: 'CREDIT_DUE_T_MINUS_3',
        vars: { ...baseVars, offsetDays: -3 },
      };
      const email = TEMPLATES.CREDIT_DUE_T_MINUS_3!.email!(payload);
      expect(email.subject).toMatch(/due in 3 days/i);
      expect(email.html).toContain('Rs 50,000');
      expect(email.text).toContain('Pay now: https://tripbng.in/wallet/credit');
    });

    it('T-1 email subject is the "due tomorrow" phrasing', () => {
      const payload: AlertPayload = {
        event: 'CREDIT_DUE_T_MINUS_1',
        vars: { ...baseVars, offsetDays: -1 },
      };
      const email = TEMPLATES.CREDIT_DUE_T_MINUS_1!.email!(payload);
      expect(email.subject).toMatch(/due tomorrow/i);
    });

    it('T+0 email subject is the "due today" phrasing', () => {
      const payload: AlertPayload = {
        event: 'CREDIT_DUE_TODAY',
        vars: { ...baseVars, offsetDays: 0 },
      };
      const email = TEMPLATES.CREDIT_DUE_TODAY!.email!(payload);
      expect(email.subject).toMatch(/due today/i);
    });

    it('T+3 email subject is the overdue phrasing', () => {
      const payload: AlertPayload = {
        event: 'CREDIT_OVERDUE',
        vars: { ...baseVars, offsetDays: 3 },
      };
      const email = TEMPLATES.CREDIT_OVERDUE!.email!(payload);
      expect(email.subject).toMatch(/overdue/i);
    });

    it('whatsapp body params include stage + amount + due date + url', () => {
      const payload: AlertPayload = {
        event: 'CREDIT_DUE_TODAY',
        vars: { ...baseVars, offsetDays: 0 },
      };
      const wa = TEMPLATES.CREDIT_DUE_TODAY!.whatsapp!(payload);
      expect(wa.templateName).toBe('credit_due_reminder');
      expect(wa.bodyParams).toHaveLength(4);
      expect(wa.bodyParams[0]).toBe('today');
      expect(wa.bodyParams[1]).toBe('Rs 50,000');
      expect(wa.bodyParams[3]).toBe('https://tripbng.in/wallet/credit');
    });

    it('in-app title/body summarises the outstanding amount', () => {
      const payload: AlertPayload = {
        event: 'CREDIT_OVERDUE',
        vars: { ...baseVars, offsetDays: 3 },
      };
      const inapp = TEMPLATES.CREDIT_OVERDUE!.inapp!(payload);
      expect(inapp.title).toMatch(/overdue/i);
      expect(inapp.body).toContain('Rs 50,000');
      expect(inapp.type).toBe('CREDIT_OVERDUE');
    });
  });

  describe('INCENTIVE_CREDITED', () => {
    const payload: AlertPayload = {
      event: 'INCENTIVE_CREDITED',
      vars: {
        depositPaise: 1_00_00_000, // ₹1,00,000
        incentivePaise: 1_00_000, // ₹1,000
        tdsPaise: 2_000, // ₹20
        netCreditPaise: 98_000, // ₹980
        walletBalanceAfterPaise: 1_00_98_000, // ₹1,00,980
      },
    };

    it('email shows the full split (deposit → gross → TDS → net)', () => {
      const email = TEMPLATES.INCENTIVE_CREDITED!.email!(payload);
      expect(email.subject).toContain('Rs 980');
      expect(email.html).toContain('Rs 1,00,000');
      expect(email.html).toContain('Rs 1,000');
      expect(email.html).toContain('-Rs 20');
      expect(email.html).toContain('Rs 1,00,980');
      expect(email.text).toContain('Net credit: Rs 980');
    });

    it('whatsapp passes the 5 positional params', () => {
      const wa = TEMPLATES.INCENTIVE_CREDITED!.whatsapp!(payload);
      expect(wa.templateName).toBe('incentive_credited');
      expect(wa.bodyParams).toHaveLength(5);
      expect(wa.bodyParams[3]).toBe('Rs 980');
    });

    it('in-app body distinguishes TDS-applicable vs not', () => {
      const inapp = TEMPLATES.INCENTIVE_CREDITED!.inapp!(payload);
      expect(inapp.body).toContain('TDS');

      const noTds: AlertPayload = {
        event: 'INCENTIVE_CREDITED',
        vars: { ...payload.vars, tdsPaise: 0, netCreditPaise: payload.vars.incentivePaise },
      };
      const inappNoTds = TEMPLATES.INCENTIVE_CREDITED!.inapp!(noTds);
      expect(inappNoTds.body).not.toContain('TDS');
    });
  });

  describe('DISTRIBUTOR_TRANSFER_IN', () => {
    const baseVars = {
      transferRef: 'DT-2026-05-20-000045',
      amountPaise: 25_000_00,
      distributorName: 'Acme Travel Distributor',
      type: 'TRANSFER' as const,
      walletBalanceAfterPaise: 75_000_00,
    };

    it('TRANSFER reads as "balance transferred to your wallet"', () => {
      const payload: AlertPayload = { event: 'DISTRIBUTOR_TRANSFER_IN', vars: baseVars };
      const email = TEMPLATES.DISTRIBUTOR_TRANSFER_IN!.email!(payload);
      expect(email.subject).toMatch(/transferred to your wallet/i);
      expect(email.html).toContain('Acme Travel Distributor');
      expect(email.html).toContain('DT-2026-05-20-000045');
    });

    it('RECALL reads as "balance recalled by distributor"', () => {
      const payload: AlertPayload = {
        event: 'DISTRIBUTOR_TRANSFER_IN',
        vars: { ...baseVars, type: 'RECALL' as const },
      };
      const email = TEMPLATES.DISTRIBUTOR_TRANSFER_IN!.email!(payload);
      expect(email.subject).toMatch(/recalled by distributor/i);
    });

    it('whatsapp param[0] switches between "received" / "recalled"', () => {
      const transfer: AlertPayload = {
        event: 'DISTRIBUTOR_TRANSFER_IN',
        vars: baseVars,
      };
      const recall: AlertPayload = {
        event: 'DISTRIBUTOR_TRANSFER_IN',
        vars: { ...baseVars, type: 'RECALL' as const },
      };
      expect(TEMPLATES.DISTRIBUTOR_TRANSFER_IN!.whatsapp!(transfer).bodyParams[0]).toBe('received');
      expect(TEMPLATES.DISTRIBUTOR_TRANSFER_IN!.whatsapp!(recall).bodyParams[0]).toBe('recalled');
    });
  });

  describe('MODULE_SWITCHED', () => {
    const payload: AlertPayload = {
      event: 'MODULE_SWITCHED',
      vars: {
        previousModule: 'CASH',
        newModule: 'CREDIT',
        notes: 'enabling credit line per agency request',
        forced: false,
      },
    };

    it('email shows both module labels', () => {
      const email = TEMPLATES.MODULE_SWITCHED!.email!(payload);
      expect(email.subject).toContain('Credit module');
      expect(email.html).toContain('Cash on Carry');
      expect(email.html).toContain('Credit module');
      expect(email.html).toContain('enabling credit line per agency request');
    });

    it('renders the force-override line only when forced=true', () => {
      const noForce = TEMPLATES.MODULE_SWITCHED!.email!(payload);
      expect(noForce.html).not.toContain('Force override');

      const forced: AlertPayload = {
        event: 'MODULE_SWITCHED',
        vars: { ...payload.vars, forced: true },
      };
      const forcedEmail = TEMPLATES.MODULE_SWITCHED!.email!(forced);
      expect(forcedEmail.html).toContain('Force override');
    });

    it('whatsapp passes previous + new labels', () => {
      const wa = TEMPLATES.MODULE_SWITCHED!.whatsapp!(payload);
      expect(wa.bodyParams).toEqual(['Cash on Carry', 'Credit module']);
    });
  });

  describe('ADJUSTMENT_POSTED', () => {
    const baseVars = {
      direction: 'CREDIT' as const,
      amountPaise: 5_000_00,
      reason: 'compensation for failed booking',
      walletBalanceAfterPaise: 12_000_00,
      wasApproved: false,
    };

    it('CREDIT reads as "Wallet credited"', () => {
      const payload: AlertPayload = { event: 'ADJUSTMENT_POSTED', vars: baseVars };
      const email = TEMPLATES.ADJUSTMENT_POSTED!.email!(payload);
      expect(email.subject).toMatch(/credited/i);
      expect(email.html).toContain('Rs 5,000');
      expect(email.html).toContain('compensation for failed booking');
    });

    it('DEBIT reads as "Wallet debited"', () => {
      const payload: AlertPayload = {
        event: 'ADJUSTMENT_POSTED',
        vars: { ...baseVars, direction: 'DEBIT' as const },
      };
      const email = TEMPLATES.ADJUSTMENT_POSTED!.email!(payload);
      expect(email.subject).toMatch(/debited/i);
    });

    it('renders "two-person approved" only when wasApproved=true', () => {
      const direct = TEMPLATES.ADJUSTMENT_POSTED!.email!({
        event: 'ADJUSTMENT_POSTED',
        vars: baseVars,
      });
      expect(direct.html).not.toContain('Two-person approved');

      const approved = TEMPLATES.ADJUSTMENT_POSTED!.email!({
        event: 'ADJUSTMENT_POSTED',
        vars: { ...baseVars, wasApproved: true },
      });
      expect(approved.html).toContain('Two-person approved');
    });
  });

  describe('router default channels — Phase-9 events', () => {
    it('credit-due reminders escalate by anchor', () => {
      // T-3 — quietest (no WhatsApp).
      expect(channelsForEvent('CREDIT_DUE_T_MINUS_3')).toEqual(['email', 'inapp']);
      // T-1 / today / overdue — escalate with WhatsApp.
      expect(channelsForEvent('CREDIT_DUE_T_MINUS_1')).toContain('whatsapp');
      expect(channelsForEvent('CREDIT_DUE_TODAY')).toContain('whatsapp');
      expect(channelsForEvent('CREDIT_OVERDUE')).toContain('whatsapp');
    });

    it('admin actions default to email + in-app only (no WhatsApp)', () => {
      expect(channelsForEvent('MODULE_SWITCHED')).toEqual(['email', 'inapp']);
      expect(channelsForEvent('ADJUSTMENT_POSTED')).toEqual(['email', 'inapp']);
    });

    it('receipts (incentive + transfer-in) are email + in-app', () => {
      expect(channelsForEvent('INCENTIVE_CREDITED')).toEqual(['email', 'inapp']);
      expect(channelsForEvent('DISTRIBUTOR_TRANSFER_IN')).toEqual(['email', 'inapp']);
    });
  });
});
