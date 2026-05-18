// TBO Holidays — Universal Hotel API host registry.
//
// TBO splits methods across THREE different base hosts. Getting this wrong
// produces 404s that look like routing bugs in our code. The HTTP client
// requires every call to specify which host it targets — no defaults.
//
// See CLAUDE.md §6.1 for the full host/method routing table.

import { env } from '../../config/env.js';

export const TBO_HOSTS = {
  /** Shared/reference data — the older SharedData service. Verified May 2026
   *  to serve only: Authenticate, Logout, GetAgencyBalance, CountryList.
   *  Auth scheme: TokenId in body. Despite earlier docs, this host does NOT
   *  serve CityList / TBOHotelCodeList / HotelDetails — those live on `hotel`. */
  shared: () => env.TBO_SHARED_BASE,
  /** TBO Holidays Hotel API — reference + availability + pricing endpoints:
   *  CityList, TBOHotelCodeList, HotelDetails, Search, PreBook. Auth scheme:
   *  HTTP Basic Auth (TBO_HOTEL_USERNAME/TBO_HOTEL_PASSWORD with fallback to
   *  TBO_USERNAME/TBO_PASSWORD), injected by the tboCall HTTP client. */
  hotel: () => env.TBO_HOTEL_BASE,
  /** Booking lifecycle: Book, GenerateVoucher, GetBookingDetail,
   *  SendChangeRequest, GetChangeRequestStatus. Same Basic Auth scheme as
   *  `hotel`. */
  hotelBe: () => env.TBO_HOTEL_BE_BASE,
  /** Flight booking-engine: Air Search, FareRule, FareQuote, SSR, Book,
   *  Ticket, GetBookingDetails, SendChangeRequest, GetChangeRequestStatus. */
  flight: () => env.TBO_FLIGHT_BASE,
} as const;

export type TboHost = keyof typeof TBO_HOSTS;
