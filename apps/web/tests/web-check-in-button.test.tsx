// Phase-G tests for the WebCheckInButton visibility + behaviour.
// Covers the conditional rendering rules + open/closed window handling.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebCheckInButton } from '@/components/web-check-in-button';

// Construct a future departure 24h out — well inside IndiGo's 48h
// check-in window. Tests that simulate "too early" / "departed" build
// their own values relative to now().
const oneDayFromNowISO = (): string =>
  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const baseBooking = {
  status: 'TICKETED',
  airlinePnr: 'ABC123',
  pnr: 'TRBNG-001',
  segments: [
    {
      airline: { code: '6E' },
      departure: oneDayFromNowISO(),
    },
  ],
  passengers: [{ lastName: 'Sharma' }],
};

describe('WebCheckInButton — visibility rules', () => {
  it('renders an active button when status=TICKETED, airlinePnr set, airline known, window open', () => {
    render(<WebCheckInButton booking={baseBooking} />);
    const link = screen.getByRole('link', { name: /web check-in/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('goindigo.in');
    expect(link.getAttribute('href')).toContain('pnr=ABC123');
    expect(link.getAttribute('href')).toContain('lastName=Sharma');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('hides entirely when status is not TICKETED', () => {
    render(<WebCheckInButton booking={{ ...baseBooking, status: 'HOLD' }} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('hides entirely when airlinePnr and pnr are both missing', () => {
    render(
      <WebCheckInButton
        booking={{ ...baseBooking, airlinePnr: null, pnr: null }}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('falls back to platform pnr when airlinePnr is null but pnr is set', () => {
    render(
      <WebCheckInButton
        booking={{ ...baseBooking, airlinePnr: null, pnr: 'FALLBACK1' }}
      />,
    );
    const link = screen.getByRole('link', { name: /web check-in/i });
    expect(link.getAttribute('href')).toContain('pnr=FALLBACK1');
  });

  it('hides for unknown airlines (no directory entry)', () => {
    render(
      <WebCheckInButton
        booking={{
          ...baseBooking,
          segments: [{ airline: { code: 'XY' }, departure: oneDayFromNowISO() }],
        }}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('WebCheckInButton — window states', () => {
  it('renders a disabled "opens later" pill when too early', () => {
    // 5 days out — outside the 48h window.
    const departure = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <WebCheckInButton
        booking={{
          ...baseBooking,
          segments: [{ airline: { code: '6E' }, departure }],
        }}
      />,
    );
    const button = screen.getByRole('button', { name: /opens later/i });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/opens in/i);
  });

  it('renders a disabled "closed" pill when the flight has departed', () => {
    const departure = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(
      <WebCheckInButton
        booking={{
          ...baseBooking,
          segments: [{ airline: { code: '6E' }, departure }],
        }}
      />,
    );
    const button = screen.getByRole('button', { name: /closed/i });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/departed/i);
  });
});
