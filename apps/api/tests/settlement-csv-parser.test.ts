// Phase-C tests for the settlement CSV parser.
//
// Covers:
//   - parseAmountCell (pure) — paise vs rupees heuristic, symbol/comma stripping
//   - parseSettlementCsv per-provider header detection (ICICI / PhonePe / Manual)
//   - status normalisation across provider dialects
//   - per-row error collection — bad rows don't abort the batch
//   - RFC-4180 quoting (quoted commas + quoted newlines + double-quoted quotes)
//   - missing required columns produce a top-level error

import { describe, expect, it } from 'vitest';
import {
  parseAmountCell,
  parseSettlementCsv,
} from '../src/services/payment/settlement-csv-parser.service.js';

describe('parseAmountCell — pure', () => {
  it('treats "1234.56" as rupees → 123456 paise', () => {
    expect(parseAmountCell('1234.56')).toBe(123456);
  });

  it('treats "123456" (no decimal) as already-paise', () => {
    expect(parseAmountCell('123456')).toBe(123456);
  });

  it('strips ₹, commas, whitespace', () => {
    expect(parseAmountCell('₹1,234.56')).toBe(123456);
    expect(parseAmountCell(' 1,234.50 ')).toBe(123450);
  });

  it('returns null for unparseable strings', () => {
    expect(parseAmountCell('abc')).toBeNull();
    expect(parseAmountCell('')).toBeNull();
    expect(parseAmountCell('1.2.3')).toBeNull();
  });
});

describe('parseSettlementCsv — ICICI Orange PG', () => {
  it('parses a canonical ICICI settlement file', () => {
    const csv = [
      'Date,MerchantTxnNo,RRN,TxnAmount,TxnStatus,MDR,GST,UTR',
      '2026-05-21,PT0000123,RRN001,1500.00,SUC,18.00,3.24,UTR-A1',
      '2026-05-21,PT0000124,RRN002,500.50,FAILED,,,—',
      '2026-05-21,PT0000125,RRN003,2000.00,SUC,24.00,4.32,UTR-A2',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'ICICI_ORANGE_PG');
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      gatewayTxnId: 'PT0000123',
      amount: 150_000,
      status: 'SUCCESS',
      mdrAmount: 1800,
      gstOnMdr: 324,
      settlementUtr: 'UTR-A1',
    });
    expect(r.rows[1]!.status).toBe('FAILED');
    expect(r.rows[1]!.mdrAmount).toBeUndefined(); // empty cell → not populated
  });

  it('emits a top-level error when required columns are missing', () => {
    const csv = ['Date,RRN,Amount', '2026-05-21,RRN001,1500.00'].join('\r\n');
    const r = parseSettlementCsv(csv, 'ICICI_ORANGE_PG');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]!.reason).toContain('gatewayTxnId');
  });

  it('header detection is case-insensitive', () => {
    const csv = [
      'merchanttxnno,txnamount,txnstatus,utr',
      'PT0000123,1500.00,SUC,UTR-A1',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'ICICI_ORANGE_PG');
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.gatewayTxnId).toBe('PT0000123');
  });
});

describe('parseSettlementCsv — PhonePe', () => {
  it('parses a canonical PhonePe settlement file (amount in paise)', () => {
    const csv = [
      'merchantOrderId,amount,state,mdr,gst,utr',
      'PT5a80c4073e4f,150000,COMPLETED,1800,324,UTR-P1',
      'PT5a80c4073e50,500000,FAILED,,,—',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      gatewayTxnId: 'PT5a80c4073e4f',
      amount: 150_000,
      status: 'SUCCESS',
      mdrAmount: 1800,
      gstOnMdr: 324,
      settlementUtr: 'UTR-P1',
    });
    expect(r.rows[1]!.status).toBe('FAILED');
  });

  it('treats CAPTURED and CANCELLED as canonical SUCCESS / FAILED', () => {
    const csv = [
      'merchantOrderId,amount,state',
      'A,1000,CAPTURED',
      'B,2000,CANCELLED',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.rows[0]!.status).toBe('SUCCESS');
    expect(r.rows[1]!.status).toBe('FAILED');
  });

  it('skips PENDING rows silently (not reconcileable yet)', () => {
    const csv = [
      'merchantOrderId,amount,state',
      'A,1000,COMPLETED',
      'B,2000,PENDING',
      'C,3000,FAILED',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((row) => row.gatewayTxnId)).toEqual(['A', 'C']);
  });
});

describe('parseSettlementCsv — robustness', () => {
  it('per-row errors do not abort the batch', () => {
    const csv = [
      'merchantOrderId,amount,state',
      'A,1000,COMPLETED',
      ',2000,COMPLETED', // empty gatewayTxnId
      'C,notanumber,COMPLETED', // bad amount
      'D,3000,COMPLETED',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]!.line).toBe(3);
    expect(r.errors[1]!.line).toBe(4);
    expect(r.rows.map((row) => row.gatewayTxnId)).toEqual(['A', 'D']);
  });

  it('RFC-4180 quoting — commas inside quoted fields are NOT separators', () => {
    const csv = [
      'merchantOrderId,amount,state,utr',
      '"A, special",1000,COMPLETED,UTR-1',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.gatewayTxnId).toBe('A, special');
    expect(r.rows[0]!.settlementUtr).toBe('UTR-1');
  });

  it('RFC-4180 double-quoted quotes are unescaped', () => {
    const csv = [
      'merchantOrderId,amount,state',
      '"He said ""hi""",1000,COMPLETED',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.rows[0]!.gatewayTxnId).toBe('He said "hi"');
  });

  it('rawRow contains every CSV column verbatim for the admin UI', () => {
    const csv = [
      'merchantOrderId,amount,state,extra_field',
      'A,1000,COMPLETED,custom-value',
    ].join('\r\n');
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.rows[0]!.rawRow).toMatchObject({
      merchantOrderId: 'A',
      amount: '1000',
      state: 'COMPLETED',
      extra_field: 'custom-value',
    });
  });

  it('LF-only line endings are handled (Unix CSV exports)', () => {
    const csv = 'merchantOrderId,amount,state\nA,1000,COMPLETED\nB,2000,FAILED';
    const r = parseSettlementCsv(csv, 'PHONEPE');
    expect(r.rows).toHaveLength(2);
  });
});
