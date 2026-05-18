// ASEGO returns failure as `{ code, msg }` in either a 4xx body or — sometimes
// — a 200 with `success: false`. We normalize all of that into AsegoError so
// upstream code only handles one shape.
//
// HTTP-level mapping at the route layer:
//    e100 (PartnerId null/empty)            → 500 (config bug, alert ops)
//    "Duplicate Record Found"                → 409 (return original policy ref)
//    "Cancellation Failed"                   → 422 (surface ASEGO msg verbatim)
//    401 Unauthorized                        → 500 (creds issue, alert ops)
//    404 Not Found                           → 404 to client
//    5xx                                     → 502 to client (axios-retry layer
//                                              already reset before we get here)

export class AsegoError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number,
    public asegoEndpoint: string,
    public asegoBody?: unknown,
  ) {
    super(message);
    this.name = 'AsegoError';
  }
}

/** Convenience throw — mirrors `throwAsSupplierError` in our other adapters. */
export function throwAsAsegoError(
  code: string,
  message: string,
  httpStatus: number,
  endpoint: string,
  body?: unknown,
): never {
  throw new AsegoError(code, message, httpStatus, endpoint, body);
}
