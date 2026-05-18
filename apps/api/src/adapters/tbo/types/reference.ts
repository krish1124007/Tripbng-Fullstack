// Reference data — request + response shapes for CountryList, CityList,
// HotelCodeList, and HotelDetails.
//
// TBO's docs are inconsistent about whether list responses are flat arrays
// or wrapped in a single-key object (e.g. CountryList[] vs
// { CountryList: { Country: [] } }). The runtime shape from the sandbox
// dictates the right parser; until that's verified, the `unwrapList` helper
// in `parsers.ts` walks both shapes so the call sites don't have to.

import type { TboErrorBlock, TboStatus } from './auth.js';

/** Most TBO methods take only the auth fields. CityList is the exception. */
export interface TboCountryListRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
}

/** Each item TBO returns in CountryList. Some versions use Code/Name,
 *  others CountryCode/CountryName. We type as a wide union. */
export interface TboCountryItem {
  Code?: string;
  CountryCode?: string;
  Name?: string;
  CountryName?: string;
}

export interface TboCountryListResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  /** Common shape: flat array. */
  CountryList?: TboCountryItem[] | { Country?: TboCountryItem[]; CountryCode?: TboCountryItem[] };
  /** Some sandbox versions hoist it. */
  Countries?: TboCountryItem[];
}

export interface TboCityListRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** ISO alpha-2. */
  CountryCode: string;
}

export interface TboCityItem {
  CityCode?: string;
  Code?: string;
  CityId?: string;
  Name?: string;
  CityName?: string;
  StateProvince?: string;
  StateName?: string;
  Latitude?: number | string;
  Longitude?: number | string;
  HotelCount?: number | string;
}

export interface TboCityListResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  CityList?: TboCityItem[] | { City?: TboCityItem[] };
  Cities?: TboCityItem[];
}

export interface TboHotelCodeListRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  CityIds: string;       // CSV of cityIds — TBO accepts multiple
  /** Optional ISO date filter. */
  IsDetailedResponse?: boolean;
}

export interface TboHotelCodeItem {
  HotelCode?: string;
  TBOHotelCode?: string;
  HotelName?: string;
  HotelRating?: number | string;
  StarRating?: number | string;
  Address?: string;
  Latitude?: number | string;
  Longitude?: number | string;
  CityCode?: string;
  CityName?: string;
  CountryCode?: string;
}

export interface TboHotelCodeListResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  Hotels?: TboHotelCodeItem[];
  HotelList?: TboHotelCodeItem[] | { Hotel?: TboHotelCodeItem[] };
}

export interface TboHotelDetailsRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
  /** CSV of hotel codes. TBO recommends ≤ ~50 per call. */
  HotelCodes: string;
  /** Recommended in batched mode — pulls fewer fields per hotel. */
  Language?: string;
}

/** Wide shape — different TBO docs versions promote different keys. The
 *  mapper in services/tbo/reference-sync.service.ts narrows to our model. */
export interface TboHotelDetailsItem {
  HotelCode?: string;
  HotelName?: string;
  StarRating?: number | string;
  HotelRating?: number | string;
  Address?: string;
  PinCode?: string;
  Latitude?: number | string;
  Longitude?: number | string;
  PhoneNumber?: string;
  Email?: string;
  Description?: string;
  HotelDescription?: string;
  HotelFacilities?: string[] | string;
  HotelAmenities?: string[] | string;
  Images?: Array<{ Url?: string; Caption?: string } | string> | string;
  HotelImages?: Array<{ Url?: string; Caption?: string } | string>;
  HotelPolicy?: string;
  CheckInTime?: string;
  CheckOutTime?: string;
  CityCode?: string;
  CountryCode?: string;
  [key: string]: unknown; // keep room for fields we'd otherwise drop
}

export interface TboHotelDetailsResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
  TraceId?: string;
  HotelDetails?: TboHotelDetailsItem[] | { Hotel?: TboHotelDetailsItem[] };
  Hotels?: TboHotelDetailsItem[];
}
