// Authenticate / Logout — request and response shapes.
//
// TBO's auth API is uniform: every method returns a top-level Status code
// (1=ok, 2=fail, 3=invalid request, 4=invalid session, 5=invalid creds)
// alongside the actual payload. We don't merge these into a discriminated
// union here because the rest of the codebase prefers wide types + service-
// layer guards — see auth.service.ts for the success/failure split.

export interface TboAuthenticateRequest {
  ClientId: string;
  UserName: string;
  Password: string;
  EndUserIp: string;
}

/** Member subdoc — agency profile attached to the token. We only persist
 *  the bits the support team typically needs; the rest stays in the audit
 *  log if we ever need it. */
export interface TboMember {
  MemberId?: number | string;
  AgencyId?: number | string;
  LoginName?: string;
  Email?: string;
  AgencyName?: string;
  Currency?: string;
  CountryCode?: string;
  TelephoneCode?: string;
  TelephoneNumber?: string;
}

/** TBO's "Status" enum — surfaced verbatim across every method, not just
 *  Authenticate. Lifted up here so service code can pattern-match. */
export const TBO_STATUS = {
  SUCCESSFUL: 1,
  FAILED: 2,
  INVALID_REQUEST: 3,
  INVALID_SESSION: 4,
  INVALID_CREDENTIALS: 5,
} as const;
export type TboStatus = (typeof TBO_STATUS)[keyof typeof TBO_STATUS];

/** Common error envelope. ErrorCode==0 means "no error". */
export interface TboErrorBlock {
  ErrorCode: number;
  ErrorMessage?: string;
}

export interface TboAuthenticateResponse {
  Status: TboStatus;
  TokenId?: string;
  Member?: TboMember;
  Error?: TboErrorBlock;
  /** TBO occasionally returns AgencyId at the top level too. */
  AgencyId?: number | string;
}

export interface TboLogoutRequest {
  ClientId: string;
  TokenId: string;
  EndUserIp: string;
}

export interface TboLogoutResponse {
  Status: TboStatus;
  Error?: TboErrorBlock;
}
