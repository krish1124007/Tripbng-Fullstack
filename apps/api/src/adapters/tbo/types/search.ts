// TBO Search request + response shapes.
//
// Like the reference-data types, the response shape varies subtly across
// docs versions — TBO sometimes hoists `Hotels` to the top level, sometimes
// nests it under `HotelSearchResult`, sometimes uses `HotelResults`. The
// types here accept the union; the mapper narrows.
//
// Money: TBO returns rates as decimal numbers (rupees, fractional). We
// always convert to integer paise at the mapper boundary so nothing inside
// our system has to deal with floats.

import type { TboErrorBlock, TboStatus } from './auth.js';

/** PaxRoom shape TBO accepts in Search.SearchRequest. */
export interface TboPaxRoom {
  Adults: number;
  Children: number;
  /** When children > 0, an array of integer ages in [0, 17]. */
  ChildrenAges?: number[];
}

export interface TboSearchRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** CSV of TBO hotel codes. Single chunk per request — caller fans out. */
  HotelCodes: string;
  /** ISO yyyy-mm-dd. */
  CheckInDate: string;
  /** Number of nights. TBO uses NoOfNights instead of CheckOut. */
  NoOfNights: number;
  /** ISO alpha-2. */
  GuestNationality: string;
  /** TBO accepts NoOfRooms + array; the array's length must match NoOfRooms. */
  NoOfRooms: number;
  RoomGuests: TboPaxRoom[];
  /** When true, returns extra fields per hotel — heavier. Default false. */
  IsDetailedResponse?: boolean;
  /** Mealtype filter — defaults to All. */
  MealType?: 'All' | 'WithMeal' | 'RoomOnly';
  /** Optional client-side max — TBO may still return more, we filter post. */
  ResponseTime?: number;
  /** Filter for refundable-only when true. */
  IsRefundable?: boolean;
}

export interface TboSearchRoom {
  /** TBO BookingCode — required for PreBook. Round-trips unchanged. */
  BookingCode: string;
  /** Per-room name (e.g. "Deluxe King"). */
  Name?: string | string[];
  Inclusion?: string;
  IsRefundable?: boolean;
  WithTransfers?: boolean;
  MealType?: string;
  /** Per-stay total. May be string in some docs versions. */
  TotalFare?: number | string;
  /** Per-stay net to TBO before our markup. */
  TotalTax?: number | string;
  RoomPromotion?: string;
  /** Some sandboxes return rates per-day in DayRates[]; we sum if needed. */
  DayRates?: Array<{ Amount: number | string; Currency?: string }>;
  /** Cancellation policies inline on the room. */
  CancellationPolicies?: TboCancellationPolicy[];
  /** Marker for "you can't decompose this fare into base+tax". */
  IsPackageFare?: boolean;
}

export interface TboCancellationPolicy {
  /** ISO datetime — date this policy band starts. */
  FromDate?: string;
  ChargeType?: 'Percentage' | 'FixedAmount' | string;
  /** Either a percentage 0-100 or a fixed amount, depending on ChargeType. */
  CancellationCharge?: number | string;
  /** Optional currency override. */
  Currency?: string;
}

export interface TboSearchHotel {
  HotelCode: string;
  HotelName?: string;
  StarRating?: number | string;
  HotelRating?: number | string;
  HotelAddress?: string;
  HotelPicture?: string;
  HotelDescription?: string;
  HotelLocation?: string;
  HotelFacilities?: string[] | string;
  /** Some endpoints return a Latitude/Longitude pair, others a Geo object. */
  Latitude?: number | string;
  Longitude?: number | string;
  Map?: string;
  /** Currency for all amounts in this hotel's rates. */
  Currency?: string;
  /** Rooms TBO matched to the request. Each carries a BookingCode. */
  Rooms?: TboSearchRoom[];
  /** Some sandboxes hoist rooms to a top-level RoomDetails. */
  RoomDetails?: TboSearchRoom[];
}

export interface TboSearchResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  /** Multiple shapes seen — mapper unwraps via parsers.unwrapList. */
  HotelSearchResult?: { HotelResults?: TboSearchHotel[] };
  HotelResults?: TboSearchHotel[];
  Hotels?: TboSearchHotel[];
}
