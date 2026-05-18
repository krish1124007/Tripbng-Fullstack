// Authenticated TBO call wrapper.
//
// Sits on top of `callTbo` (the raw transport) and adds the things every
// non-Authenticate method needs. The behaviour is host-aware because TBO
// runs two services with different auth contracts:
//
//   shared  (SharedData)         — TokenId-in-body. We fetch a token, inject
//                                  ClientId/TokenId/EndUserIp into the body,
//                                  and on Status=4 (InValidSession) refresh + retry.
//   hotel   (Hotel API)          — HTTP Basic Auth. Token-in-body is not used.
//   hotelBe (Hotel-BE)             We only check Status.Code for success/failure.
//
// `callTbo` (the unauthenticated primitive) returns the parsed body for both
// shapes; this wrapper is the layer that interprets it.

import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import {
  callTbo,
  type TboCallContext,
  type TboCallOptions,
} from '../../adapters/tbo/client.js';
import { TboError, statusToErrorCode } from '../../adapters/tbo/errors.js';
import { TBO_STATUS } from '../../adapters/tbo/types/auth.js';
import { tboAuthService } from './auth.service.js';

interface TboResponseEnvelope {
  Status?: number | { Code?: number; Description?: string };
  Error?: { ErrorCode?: number; ErrorMessage?: string };
  TraceId?: string;
}

export interface TboCallArgs<TBody extends Record<string, unknown>> {
  /** Method name — used in audit + error messages. */
  method: string;
  /** Which TBO host to target. */
  host: TboCallOptions['host'];
  /** Path on the host (must start with `/`). */
  path: string;
  /** Method-specific body fields. ClientId/TokenId/EndUserIp are added
   *  automatically — DO NOT include them. */
  body: TBody;
  ctx?: TboCallContext;
  timeoutMs?: number;
}

/**
 * Authenticated TBO call. Throws TboError on any non-success Status.
 *
 * Routes by host:
 *   - `shared`  → token-in-body flow (fetch + inject + InValidSession retry).
 *   - `hotel`/`hotelBe` → Basic Auth flow (no token, body is sent as-is; the
 *     low-level callTbo injects the Authorization header).
 */
export async function tboCall<TResponse extends TboResponseEnvelope>(
  args: TboCallArgs<Record<string, unknown>>,
): Promise<TResponse> {
  if (args.host === 'hotel' || args.host === 'hotelBe') {
    return assertSuccess(
      await callTbo<TResponse>({
        method: args.method,
        host: args.host,
        path: args.path,
        body: args.body,
        ctx: args.ctx,
        timeoutMs: args.timeoutMs,
      }),
      args.method,
    );
  }

  // SharedData / Flight: token-in-body flow.
  if (!env.TBO_END_USER_IP) {
    throw new TboError('TBO_NOT_CONFIGURED', 'TBO_END_USER_IP not set', {
      method: args.method,
      retryable: false,
    });
  }

  const tokenId = await tboAuthService.getToken();
  const res = await invokeWithToken<TResponse>(args, tokenId);

  // InValidSession → force-refresh and retry once. We don't loop: a second
  // 4 means something is genuinely broken (wrong creds, token format change,
  // …) and looping would burn API quota.
  if (typeof res.Status === 'number' && res.Status === TBO_STATUS.INVALID_SESSION) {
    logger.warn({ method: args.method }, 'tbo: InValidSession, force-refreshing + retrying');
    const fresh = await tboAuthService.forceRefresh();
    return assertSuccess(await invokeWithToken<TResponse>(args, fresh), args.method);
  }
  return assertSuccess(res, args.method);
}

async function invokeWithToken<TResponse extends TboResponseEnvelope>(
  args: TboCallArgs<Record<string, unknown>>,
  tokenId: string,
): Promise<TResponse> {
  return callTbo<TResponse>({
    method: args.method,
    host: args.host,
    path: args.path,
    body: {
      ClientId: env.TBO_CLIENT_ID,
      TokenId: tokenId,
      EndUserIp: env.TBO_END_USER_IP,
      ...args.body,
    },
    ctx: args.ctx,
    timeoutMs: args.timeoutMs,
  });
}

function assertSuccess<TResponse extends TboResponseEnvelope>(
  res: TResponse,
  method: string,
): TResponse {
  // SharedData success: Status === 1.
  if (typeof res.Status === 'number') {
    if (res.Status === TBO_STATUS.SUCCESSFUL) return res;
    const code = statusToErrorCode(res.Status as 1 | 2 | 3 | 4 | 5);
    throw new TboError(code ?? 'TBO_UNKNOWN', res.Error?.ErrorMessage ?? `${method} failed`, {
      method,
      tboStatus: res.Status as 1 | 2 | 3 | 4 | 5,
      tboErrorCode: res.Error?.ErrorCode,
      tboMessage: res.Error?.ErrorMessage,
      traceId: res.TraceId,
      retryable: false,
    });
  }
  // Hotel API success: Status.Code === 200 (or no Status at all on payload-only
  // responses — treat undefined as success and let the caller's parser decide).
  if (res.Status && typeof res.Status === 'object') {
    const obj = res.Status as { Code?: number; Description?: string };
    if (obj.Code === 200) return res;
    // 401 from Hotel API ≡ Basic-Auth credential rejection. Everything else
    // is a generic upstream business failure.
    const code = obj.Code === 401 ? 'TBO_INVALID_CREDENTIALS' : 'TBO_FAILED';
    throw new TboError(code, obj.Description ?? `${method} failed`, {
      method,
      httpStatus: obj.Code,
      tboMessage: obj.Description,
      retryable: false,
    });
  }
  return res;
}
