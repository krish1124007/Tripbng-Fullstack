// Credit-due reminder — shared template for the four anchors (T-3 / T-1 /
// T+0 / T+3). The event name picks tone + subject; the var shape is
// identical across the four.

import type { AlertEvent, AlertPayload, AlertTemplate } from '../types.js';
import { rs } from '../types.js';
import { brandingForLayout, ctaButton, emailLayout, kvTable } from './_layout.js';

const CREDIT_DUE_EVENTS = [
  'CREDIT_DUE_T_MINUS_3',
  'CREDIT_DUE_T_MINUS_1',
  'CREDIT_DUE_TODAY',
  'CREDIT_OVERDUE',
] as const satisfies readonly AlertEvent[];

type CreditDueEvent = (typeof CREDIT_DUE_EVENTS)[number];

function isCreditDueEvent(e: AlertEvent): e is CreditDueEvent {
  return (CREDIT_DUE_EVENTS as readonly string[]).includes(e);
}

function tone(event: CreditDueEvent): {
  heading: string;
  preheader: string;
  color: string;
} {
  switch (event) {
    case 'CREDIT_DUE_T_MINUS_3':
      return {
        heading: 'Credit payment due in 3 days',
        preheader: 'Heads-up — a payment is coming up. Plan your settlement.',
        color: '#0891b2', // teal — informational
      };
    case 'CREDIT_DUE_T_MINUS_1':
      return {
        heading: 'Credit payment due tomorrow',
        preheader: 'One day left — settle to avoid booking interruptions.',
        color: '#d97706', // amber — warning
      };
    case 'CREDIT_DUE_TODAY':
      return {
        heading: 'Credit payment due today',
        preheader: 'Settle today to keep bookings flowing.',
        color: '#b45309', // amber-dark — urgent
      };
    case 'CREDIT_OVERDUE':
      return {
        heading: 'Credit payment overdue',
        preheader: 'Your credit is 3 days past due. Bookings may be blocked.',
        color: '#b91c1c', // red — overdue
      };
  }
}

export const creditDueReminderTemplate: AlertTemplate = {
  email(payload, branding) {
    if (!isCreditDueEvent(payload.event)) {
      throw new Error(`creditDueReminderTemplate.email called with ${payload.event}`);
    }
    const v = (payload as Extract<AlertPayload, { event: CreditDueEvent }>).vars;
    const t = tone(payload.event);
    const subject = `${t.heading} — ${rs(v.creditUsedPaise)} outstanding`;
    const html = emailLayout({
      title: subject,
      preheader: t.preheader,
      branding: brandingForLayout(branding),
      bodyHtml: `
<h1 style="margin:0 0 12px;font-size:20px;color:${t.color};">${t.heading}</h1>
<p style="margin:0 0 16px;color:#475569;">${t.preheader}</p>
${kvTable([
  ['Outstanding credit', rs(v.creditUsedPaise)],
  ['Credit limit', rs(v.creditLimitPaise)],
  ['Due date', new Date(v.dueDate).toDateString()],
])}
${ctaButton('Pay now', v.payNowUrl)}`,
    });
    const text = [
      t.heading,
      `Outstanding: ${rs(v.creditUsedPaise)}`,
      `Credit limit: ${rs(v.creditLimitPaise)}`,
      `Due: ${new Date(v.dueDate).toDateString()}`,
      ``,
      `Pay now: ${v.payNowUrl}`,
      `— TripBng`,
    ].join('\n');
    return { subject, html, text };
  },

  whatsapp(payload) {
    if (!isCreditDueEvent(payload.event)) {
      throw new Error(`creditDueReminderTemplate.whatsapp called with ${payload.event}`);
    }
    const v = (payload as Extract<AlertPayload, { event: CreditDueEvent }>).vars;
    // Meta-approved template assumed: `credit_due_reminder`
    // {{1}} stage (heads-up | tomorrow | today | overdue), {{2}} outstanding, {{3}} due date, {{4}} payNowUrl
    const stage =
      payload.event === 'CREDIT_DUE_T_MINUS_3'
        ? 'heads-up'
        : payload.event === 'CREDIT_DUE_T_MINUS_1'
          ? 'tomorrow'
          : payload.event === 'CREDIT_DUE_TODAY'
            ? 'today'
            : 'overdue';
    return {
      templateName: 'credit_due_reminder',
      bodyParams: [stage, rs(v.creditUsedPaise), new Date(v.dueDate).toDateString(), v.payNowUrl],
    };
  },

  inapp(payload) {
    if (!isCreditDueEvent(payload.event)) {
      throw new Error(`creditDueReminderTemplate.inapp called with ${payload.event}`);
    }
    const v = (payload as Extract<AlertPayload, { event: CreditDueEvent }>).vars;
    const t = tone(payload.event);
    return {
      title: t.heading,
      body: `${rs(v.creditUsedPaise)} outstanding • due ${new Date(v.dueDate).toDateString()}`,
      type: payload.event,
      actionUrl: '/wallet/credit',
    };
  },
};
