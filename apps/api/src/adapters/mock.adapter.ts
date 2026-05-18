import crypto from 'node:crypto';
import { BaseAdapter } from './base.js';
import { SupplierAdapterError } from './types.js';
import type {
  Capability,
  NormalizedBookingDetails,
  NormalizedCancelRequest,
  NormalizedCancelResponse,
  NormalizedFareOption,
  NormalizedHoldRequest,
  NormalizedHoldResponse,
  NormalizedSearchRequest,
  NormalizedSearchResponse,
  NormalizedTicketRequest,
  NormalizedTicketResponse,
} from './types.js';

// MockAdapter — synthesizes deterministic results for development and tests so the search
// page doesn't go empty when there's no series inventory yet. Every call is fast; results
// vary by route via a hashed seed.
export class MockAdapter extends BaseAdapter {
  readonly code = 'MOCK';
  readonly name = 'Mock Carrier';
  readonly capabilities: readonly Capability[] = ['SEARCH', 'HOLD', 'BOOK', 'CANCEL'];

  async search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse> {
    return this.guarded('search', async () => {
      const segment = req.request.segments[0];
      if (!segment) return { options: [] };
      const seed = hashSeed(
        `${segment.origin}-${segment.destination}-${segment.date.toISOString().slice(0, 10)}`,
      );

      const options: NormalizedFareOption[] = [];
      const variants = 3;
      for (let i = 0; i < variants; i++) {
        const baseFare = 350_000 + ((seed + i * 23) % 250_000);
        const taxes = 50_000 + ((seed + i * 11) % 30_000);
        const dep = combineDateAndTime(segment.date, hourFor(seed, i));
        const dur = 90 + ((seed + i * 17) % 60);
        const arr = new Date(dep.getTime() + dur * 60_000);

        options.push({
          supplierFareId: `MOCK-${i}-${segment.origin}-${segment.destination}-${segment.date.toISOString().slice(0, 10)}`,
          segments: [
            {
              flightNumber: `MK ${1000 + i + (seed % 99)}`,
              airline: { code: 'MK', name: 'Mock Airways' },
              origin: { code: segment.origin },
              destination: { code: segment.destination },
              departure: dep.toISOString(),
              arrival: arr.toISOString(),
              duration: dur,
              stopOver: 0,
            },
          ],
          travelClass: req.request.travelClass,
          perPax: {
            adult: { baseFarePaise: baseFare, taxesPaise: taxes },
            child: { baseFarePaise: Math.round(baseFare * 0.75), taxesPaise: taxes },
            infant: { baseFarePaise: 50_000, taxesPaise: 0 },
          },
          refundable: i === 0,
          fareRuleDescription:
            i === 0
              ? 'Refundable; cancel >= 24h forfeits 25% else non-refundable'
              : 'Non-refundable',
          baggageCheckin: '15KG',
          baggageCabin: '7KG',
          seatsRemaining: 9,
          source: 'LCC',
          supplierFareToken: `MOCK:${segment.origin}:${segment.destination}:${segment.date.toISOString().slice(0, 10)}:${i}`,
        });
      }
      return { options };
    });
  }

  async hold(req: NormalizedHoldRequest): Promise<NormalizedHoldResponse> {
    return this.guarded('hold', async () => {
      if (!req.supplierFareToken.startsWith('MOCK:')) {
        throw new SupplierAdapterError('BAD_REQUEST', 'mock hold needs a MOCK: token');
      }
      return {
        supplierBookingRef: `MK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        pnr: `MKP${Math.floor(Math.random() * 99999)
          .toString()
          .padStart(5, '0')}`,
      };
    });
  }

  async ticket(_req: NormalizedTicketRequest): Promise<NormalizedTicketResponse> {
    return this.guarded('ticket', async () => ({
      pnr: `MKP${Math.floor(Math.random() * 99999)
        .toString()
        .padStart(5, '0')}`,
      ticketNumbers: [`MK${Math.floor(Math.random() * 9999999999)}`],
    }));
  }

  async cancel(_req: NormalizedCancelRequest): Promise<NormalizedCancelResponse> {
    return this.guarded('cancel', async () => ({ ok: true, refundAmountPaise: 0 }));
  }

  async retrieveBooking(ref: string): Promise<NormalizedBookingDetails> {
    return { supplierBookingRef: ref, status: 'CONFIRMED' };
  }
}

function hashSeed(s: string): number {
  return crypto.createHash('sha256').update(s).digest().readUInt32BE(0);
}

function hourFor(seed: number, idx: number): string {
  const hours = [6, 9, 13, 17, 20];
  const h = hours[(seed + idx) % hours.length] ?? 6;
  return `${String(h).padStart(2, '0')}:${idx % 2 === 0 ? '15' : '45'}`;
}

function combineDateAndTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const out = new Date(date);
  out.setHours(h ?? 0, m ?? 0, 0, 0);
  return out;
}
