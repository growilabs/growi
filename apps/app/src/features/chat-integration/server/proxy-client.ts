// GROWI's single outbound channel to the chat-integration proxy (design.md
// `ProxyClient`, Requirements 1.3, 1.4, 10.1). Every one of the 8 things
// GROWI sends to the proxy goes through the two low-level helpers below
// (`callSignedOp` for the 7 signed ops, `submitPairing` for the one
// unsigned one) -- so a caller can never build a proxy request from scratch
// and skip one of the properties this file exists to guarantee.
//
// Four decisions shape this module, mirroring the proxy's own
// `growi-client.ts` (`apps/chat-integration-proxy/src/growi/growi-client.ts`),
// which does the same job in the opposite direction:
//
//  - **The body is serialized exactly once.** `sign()` hashes the exact
//    bytes it is handed, and the peer hashes the exact bytes it receives.
//    `JSON.stringify` runs once, in `callSignedOp`/`submitPairing`, and the
//    same string is both signed and sent -- never rebuilt in between.
//  - **`relationId` and `op` are stamped here, never taken from a caller's
//    object.** `op` is the one value the signature ties to an endpoint (the
//    target URL is not covered -- a reverse proxy may rewrite it), so a
//    caller-supplied `op` could silently sign a request for the wrong
//    endpoint. Every op-specific function below is the only place that
//    decides its own `op`.
//  - **The answer is only ever a parsed value, never `response.data`
//    handed straight to a caller.** A proxy answer carries no signature
//    (design.md: "受け取った応答は必ず検査関数を通す... 応答に署名は付かない
//    ので、形の確かめが唯一の受け入れ条件"), so `@growi/chat`'s parse
//    function for that op is the WHOLE acceptance gate, not a second check
//    layered on top of something else.
//  - **`settings-push` is the one signed op with no response body to
//    parse.** The proxy answers it with a bare 204 (see
//    `apps/chat-integration-proxy/src/routes/notification-routes.ts`), and
//    `@growi/chat` declares no wire type for "settings push acknowledged" --
//    there is nothing to check beyond the success status itself, which
//    `callSignedOp` already turns into `http-error` when it is missing.
//
// Retrying is the caller's decision (task 8.2's `NotificationDispatcher`,
// among others): calling the same function again re-signs from scratch --
// fresh nonce, fresh `created`/`expires` -- while the body's own
// `requestId` (where the op has one) stays whatever the caller passed in.
// A `SignResult` is never held past the single request it was made for.

import type {
  CapabilityReport,
  ChannelInventory,
  ConnectionStatusView,
  KeyOperationResult,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  NotificationRequest,
  NotificationResult,
  OpName,
  PairingResult,
  PairingSubmission,
  SettingsPushRequest,
} from '@growi/chat';
import {
  OP_ENDPOINTS,
  OP_NAMES,
  parseCapabilityReport,
  parseChannelInventory,
  parseConnectionStatusView,
  parseKeyOperationResult,
  parseNotificationResult,
  parsePairingResult,
} from '@growi/chat';
import { DEFAULT_EXPIRES_IN_SEC } from '@growi/chat/server';
import urljoin from 'url-join';

import axios from '~/utils/axios';

import { signWithOwnKey } from './keys';
import { ChatRelation } from './models/chat-relation';

/**
 * Why a call to the proxy did not produce an answer this GROWI may act on.
 * Deliberately coarse, matching the proxy's own `GrowiCallFailure` --
 * anything finer would describe the proxy's own view of the network to
 * whichever GROWI-side caller asked.
 */
export type ProxyCallFailure =
  /** `relationId` names no `chat_relations` row -- there is no `proxyUri` to send to. */
  | 'unknown-relation'
  /** This relation has no currently-usable own-side signing key (`signWithOwnKey` refused). */
  | 'no-signing-key'
  /** The proxy never finished answering. */
  | 'unreachable'
  /** A non-2xx status: the transport failed, so the body means nothing. */
  | 'http-error'
  /** An answer that is not JSON, or does not have the shape it claims. */
  | 'malformed-response';

export type ProxyCallResult<T> =
  | { readonly ok: true; readonly response: T }
  | { readonly ok: false; readonly reason: ProxyCallFailure };

const CONTENT_TYPE = 'application/json';
const PROXY_URI_PLACEHOLDER = '{proxyUri}';

/**
 * The shape this module reads off an axios response -- narrower than
 * `AxiosResponse` on purpose, so this file never needs a type-only import
 * from the `axios` package (biome's `noRestrictedImports` bans importing
 * it anywhere in `apps/app`, `~/utils/axios` included; see
 * `.claude/rules/coding-style.md`'s single-source-of-truth boundary).
 * `AxiosResponse` structurally satisfies this, so no cast is needed at the
 * call sites below.
 */
interface RawHttpResponse {
  readonly status: number;
  readonly data: unknown;
}

/**
 * The path template `OP_ENDPOINTS` declares for a `growi-to-proxy` op, with
 * the `{proxyUri}` placeholder stripped -- read from the shared routing
 * table rather than written out again here, so this file cannot drift from
 * the table `signature-guard.ts`/`peer-router.ts` build their own op
 * vocabulary from.
 */
const pathForOp = (op: OpName): string => {
  const descriptor = OP_ENDPOINTS[op];
  if (descriptor.direction !== 'growi-to-proxy') {
    throw new Error(
      `proxy-client: '${op}' is not an op GROWI sends to the proxy`,
    );
  }
  if (!descriptor.pathTemplate.startsWith(PROXY_URI_PLACEHOLDER)) {
    throw new Error(
      `proxy-client: OP_ENDPOINTS['${op}'].pathTemplate ('${descriptor.pathTemplate}') does not start with '${PROXY_URI_PLACEHOLDER}'`,
    );
  }
  return descriptor.pathTemplate.slice(PROXY_URI_PLACEHOLDER.length);
};

/**
 * The one unsigned entry point (design.md's op table, "ペアリングの申請
 * （署名なし）"). Has no row in `OP_ENDPOINTS` -- like the proxy's own
 * `PAIRING_SUBMIT_PATH`, this is a structural absence (`op-names.ts`'s own
 * comment: the two unsigned entry points carry no `relationId`, no `op`,
 * and no signature, so there is nothing for the shared table to key on),
 * not an oversight, so the path is written out here instead.
 */
const PAIRING_SUBMIT_PATH = '/chat-integration/pairing/submit';

/** What every `@growi/chat` `parse*` function answers with when the shape does not hold. */
type ParseError = { readonly error: unknown };
type Parse<T> = (raw: unknown) => T | ParseError;

const isParseError = <T extends object>(
  parsed: T | ParseError,
): parsed is ParseError => 'error' in parsed;

/**
 * `chat_relations.proxyUri` for a relation, or `null` when the relation is
 * unknown. The base URL every op is sent against (design.md: "送り先は保存
 * した相手の URL を土台にする").
 */
const resolveProxyUri = async (relationId: string): Promise<string | null> => {
  const relation = await ChatRelation.findOne({ relationId }).lean();
  return relation?.proxyUri ?? null;
};

/**
 * Sends one signed op to the proxy and returns the raw, still-unparsed
 * outcome -- the shared plumbing behind every signed op below. Callers
 * decide separately how (or whether) to parse a successful body, since
 * `settings-push`'s successful answer carries none.
 */
const sendSigned = async (
  relationId: string,
  op: OpName,
  bodyFields: Record<string, unknown>,
): Promise<
  | { readonly ok: true; readonly rawBody: string }
  | { readonly ok: false; readonly reason: ProxyCallFailure }
> => {
  const proxyUri = await resolveProxyUri(relationId);
  if (proxyUri == null) {
    return { ok: false, reason: 'unknown-relation' };
  }

  // Serialized ONCE: `payload` is both what is hashed and what is sent (see
  // this file's header comment).
  const payload = JSON.stringify({ relationId, op, ...bodyFields });
  const headers = { 'content-type': CONTENT_TYPE };

  let signed: Awaited<ReturnType<typeof signWithOwnKey>>;
  try {
    signed = await signWithOwnKey({
      relationId,
      method: 'POST',
      headers,
      body: Buffer.from(payload, 'utf8'),
      expiresInSec: DEFAULT_EXPIRES_IN_SEC,
    });
  } catch {
    return { ok: false, reason: 'no-signing-key' };
  }

  let response: RawHttpResponse;
  try {
    response = await axios.post(urljoin(proxyUri, pathForOp(op)), payload, {
      headers: { ...headers, ...signed.headers },
      // The default JSON transform would either parse a malformed body
      // itself (surfacing as a generic thrown error this function cannot
      // tell apart from a network failure) or silently swallow a parse
      // failure -- neither distinguishes `unreachable` from
      // `malformed-response`. Keeping the body a raw string here and
      // parsing it explicitly at each call site is what makes that
      // distinction possible.
      transformResponse: (data: unknown) =>
        typeof data === 'string' ? data : '',
      // Status is checked explicitly below, rather than letting axios throw
      // on a non-2xx -- a rejection thrown from `axios.post` would land in
      // the same `catch` as a genuine network failure and be reported as
      // `unreachable` instead of `http-error`.
      validateStatus: () => true,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: 'http-error' };
  }
  return {
    ok: true,
    rawBody: typeof response.data === 'string' ? response.data : '',
  };
};

/**
 * Sends one signed op whose successful answer is a JSON body, and runs that
 * body through its op's own `parse*` function before ever handing it to a
 * caller -- design.md's "受け取った応答は必ず検査関数を通す".
 *
 * `T` is always given explicitly at the call sites below -- left to
 * inference from `parse`'s own return type, it would absorb the parse
 * function's own error variant (`T = NotificationResult | ParseError`), and
 * a value that failed to parse would typecheck its way back out to the
 * caller as if it had succeeded (the same reasoning
 * `apps/chat-integration-proxy/src/growi/growi-client.ts`'s `call` records
 * for its own `T`).
 */
const callSignedOp = async <T extends object>(
  relationId: string,
  op: OpName,
  bodyFields: Record<string, unknown>,
  parse: Parse<T>,
): Promise<ProxyCallResult<T>> => {
  const sent = await sendSigned(relationId, op, bodyFields);
  if (!sent.ok) {
    return sent;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(sent.rawBody);
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }

  const parsed = parse(raw);
  if (isParseError(parsed)) {
    return { ok: false, reason: 'malformed-response' };
  }
  return { ok: true, response: parsed };
};

/** Requirement 2.1-2.6: post a notification to the given channels of this relation. */
export const notify = (
  relationId: string,
  params: Pick<
    NotificationRequest,
    'requestId' | 'targets' | 'markdown' | 'containsRestrictedPage'
  >,
): Promise<ProxyCallResult<NotificationResult>> =>
  callSignedOp<NotificationResult>(
    relationId,
    OP_NAMES.notification,
    params,
    parseNotificationResult,
  );

/**
 * Requirement 11.1/11.2/11.4: push this relation's current channel
 * permissions, at a new `version`, to the proxy's cache.
 *
 * The successful answer is `void` -- see this file's header comment on why
 * there is no body to check for this one op. A malformed answer is still
 * impossible to represent here (only `sendSigned`'s own failure reasons
 * apply), which is deliberate: there is nothing to be malformed about.
 */
export const pushSettings = async (
  relationId: string,
  params: Pick<SettingsPushRequest, 'settings' | 'version'>,
): Promise<ProxyCallResult<void>> => {
  const sent = await sendSigned(relationId, OP_NAMES.settingsPush, params);
  if (!sent.ok) {
    return sent;
  }
  return { ok: true, response: undefined };
};

/** Requirement 10.5: register an additional public key of this GROWI's with the proxy. */
export const registerKeyWithProxy = (
  relationId: string,
  key: KeyRegistrationRequest['key'],
): Promise<ProxyCallResult<KeyOperationResult>> =>
  callSignedOp<KeyOperationResult>(
    relationId,
    OP_NAMES.keyRegisterToProxy,
    { key },
    parseKeyOperationResult,
  );

/** Requirement 10.5: revoke one of this GROWI's own keys as the proxy knows it. */
export const revokeKeyWithProxy = (
  relationId: string,
  keyId: KeyRevocationRequest['keyId'],
): Promise<ProxyCallResult<KeyOperationResult>> =>
  callSignedOp<KeyOperationResult>(
    relationId,
    OP_NAMES.keyRevokeToProxy,
    { keyId },
    parseKeyOperationResult,
  );

/** Requirement 1.3: what each connected chat service can do, for the admin screen. */
export const fetchCapabilities = (
  relationId: string,
): Promise<ProxyCallResult<CapabilityReport>> =>
  callSignedOp<CapabilityReport>(
    relationId,
    OP_NAMES.capabilities,
    {},
    parseCapabilityReport,
  );

/** Requirement 1.4: connection health for this relation's service, for the admin screen. */
export const fetchConnectionStatus = (
  relationId: string,
): Promise<ProxyCallResult<ConnectionStatusView>> =>
  callSignedOp<ConnectionStatusView>(
    relationId,
    OP_NAMES.connectionStatus,
    {},
    parseConnectionStatusView,
  );

/** Requirement 2.2/11.1: the channel inventory the admin screen picks notification targets from. */
export const fetchChannels = (
  relationId: string,
): Promise<ProxyCallResult<ChannelInventory>> =>
  callSignedOp<ChannelInventory>(
    relationId,
    OP_NAMES.channels,
    {},
    parseChannelInventory,
  );

/**
 * Requirement 9.1-9.5: submit a registration code to the given proxy,
 * carrying this GROWI's own public key. The ONE unsigned op -- no
 * `relationId` exists yet to sign with or send along (design.md: "申し込み
 * だけ署名が無い。鍵がまだ無い段のため") -- so unlike every other function in
 * this file, the target is an explicit `proxyUri` rather than a stored
 * relation's.
 */
export const submitPairing = async (
  proxyUri: string,
  submission: PairingSubmission,
): Promise<ProxyCallResult<PairingResult>> => {
  const payload = JSON.stringify(submission);

  let response: RawHttpResponse;
  try {
    response = await axios.post(
      urljoin(proxyUri, PAIRING_SUBMIT_PATH),
      payload,
      {
        headers: { 'content-type': CONTENT_TYPE },
        transformResponse: (data: unknown) =>
          typeof data === 'string' ? data : '',
        validateStatus: () => true,
      },
    );
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: 'http-error' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(typeof response.data === 'string' ? response.data : '');
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }

  const parsed = parsePairingResult(raw);
  if (isParseError(parsed)) {
    return { ok: false, reason: 'malformed-response' };
  }
  return { ok: true, response: parsed };
};
