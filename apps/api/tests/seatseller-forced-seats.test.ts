// Forced-seats parser tests. Spec §13 defines the two-list format
// `<femaleSeats>@<maleSeats>` plus the UI rule that a passenger MUST
// pick from the forced list before any other seat is selectable for
// that gender. The pure parser is straightforward; the UI rule
// (canPickFreely) gets the bulk of the assertions.

import { describe, expect, it } from 'vitest';
import { canPickFreely, parseForcedSeats } from '../src/adapters/seatseller/utils/forced-seats.js';

describe('parseForcedSeats', () => {
  it('parses a populated string with both halves', () => {
    expect(parseForcedSeats('L4,L3@U7,U8')).toEqual({
      female: ['L4', 'L3'],
      male: ['U7', 'U8'],
    });
  });

  it('handles trailing-empty male half', () => {
    expect(parseForcedSeats('U11@')).toEqual({ female: ['U11'], male: [] });
  });

  it('handles leading-empty female half', () => {
    expect(parseForcedSeats('@A1,A2')).toEqual({ female: [], male: ['A1', 'A2'] });
  });

  it('handles empty / nullish input', () => {
    expect(parseForcedSeats('')).toEqual({ female: [], male: [] });
    expect(parseForcedSeats(null)).toEqual({ female: [], male: [] });
    expect(parseForcedSeats(undefined)).toEqual({ female: [], male: [] });
    expect(parseForcedSeats('   ')).toEqual({ female: [], male: [] });
  });

  it('falls back to female-only when no @ separator (legacy shape)', () => {
    expect(parseForcedSeats('L1,L2,L3')).toEqual({ female: ['L1', 'L2', 'L3'], male: [] });
  });

  it('trims whitespace and drops empty tokens', () => {
    expect(parseForcedSeats(' L4 , , L3 @ U7 , ')).toEqual({
      female: ['L4', 'L3'],
      male: ['U7'],
    });
  });
});

describe('canPickFreely', () => {
  const forced = parseForcedSeats('L4,L3@U7,U8');

  it('FEMALE without any forced pick → must pick from list', () => {
    expect(canPickFreely('FEMALE', forced, [])).toEqual({ ok: false, mustPick: ['L4', 'L3'] });
    expect(canPickFreely('FEMALE', forced, ['A1'])).toEqual({ ok: false, mustPick: ['L4', 'L3'] });
  });

  it('FEMALE with at least one forced seat picked → free to pick more', () => {
    expect(canPickFreely('FEMALE', forced, ['L4'])).toEqual({ ok: true });
    expect(canPickFreely('FEMALE', forced, ['L4', 'A1'])).toEqual({ ok: true });
  });

  it('MALE without any forced pick → must pick from list', () => {
    expect(canPickFreely('MALE', forced, [])).toEqual({ ok: false, mustPick: ['U7', 'U8'] });
  });

  it('MALE with one forced seat picked → free', () => {
    expect(canPickFreely('MALE', forced, ['U8'])).toEqual({ ok: true });
  });

  it('OTHER gender bypasses the forced rule', () => {
    expect(canPickFreely('OTHER', forced, [])).toEqual({ ok: true });
  });

  it('returns ok when no forced list exists for the gender', () => {
    const onlyFemaleForced = parseForcedSeats('L4@');
    expect(canPickFreely('MALE', onlyFemaleForced, [])).toEqual({ ok: true });
    const onlyMaleForced = parseForcedSeats('@U1');
    expect(canPickFreely('FEMALE', onlyMaleForced, [])).toEqual({ ok: true });
  });

  it('returns ok when no forced seats exist at all', () => {
    const empty = parseForcedSeats('');
    expect(canPickFreely('FEMALE', empty, [])).toEqual({ ok: true });
    expect(canPickFreely('MALE', empty, [])).toEqual({ ok: true });
  });
});
