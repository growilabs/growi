// Every signed request the proxy sends to a GROWI (design.md's `GrowiClient`,
// Requirements 3.1, 4.2, 5.2, 7.3, 9.2, 10.1, 11.4, 14.2).
//
// Five things below are the contract, not implementation taste:
//
//  - **Every send goes through `GrowiUriResolver.connect()`.** design.md:
//    「`GrowiClient` は必ず `GrowiUriResolver` を通す。直に `fetch` しない」 --
//    two places that build HTTP requests are two places the declared-URI
//    judgement can be missing from, and only one of them would be noticed.
//  - **The body is serialized exactly once.** `sign()` hashes the bytes it is
//    handed and the peer hashes the bytes it receives, so a body re-serialized
//    between signing and sending would differ in key order or number
//    formatting and be refused as tampered with. `JSON.stringify` runs once
//    here and the same value feeds both.
//  - **`op` is stamped by the method that was called**, never taken from the
//    caller's object. `op` is the only routing value the signature covers
//    (`covered-components.ts`), and the key registration / revocation bodies
//    carry a two-member `op` union whose other member is the GROWI -> proxy
//    direction; letting a caller's value through would let the wrong direction
//    be sent and `acceptEnvelope` would refuse it on arrival with nothing to
//    point at.
//  - **`relationId` is NOT stamped -- it is the caller's value, passed through
//    as-is.** The one value the caller supplied is what goes into the outgoing
//    body AND what `keyService.signerFor()` is asked for, so the signed
//    relation and the body's relation are the same value by construction (one
//    read, not two values compared). Pairing the right `relationId` with the
//    right `growiUri` for a given call is therefore entirely the CALLER's
//    responsibility: `GrowiClient` does not check that the two belong to the
//    same relation, and has nothing to check it against.
//  - **The answer is only ever a parsed value.** GROWI's answers carry no
//    signature (design.md: 「応答に署名は付かないので形の確かめが唯一の受け入れ
//    条件」), so the parse function is the whole acceptance gate. Nothing
//    reaches a caller without passing one.
//
// Retrying is the caller's decision (`FanOutCollector`, task 6.3): calling a
// method again with the SAME request object re-signs from scratch -- fresh
// nonce, fresh `created`/`expires` -- while the body bytes, and therefore
// `requestId` and `content-digest`, stay identical. A `SignResult` is never
// held past the one request it was made for.

import type {
  AccountLinkStartRequest,
  AccountLinkStartResponse,
  CommandRequest,
  CommandResponse,
  KeyOperationResult,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  OpName,
  OpOnlyRequest,
  RequestEnvelope,
  SettingsPullResponse,
} from '@growi/chat';
import {
  OP_ENDPOINTS,
  OP_NAMES,
  parseAccountLinkStartResponse,
  parseCommandResponse,
  parseKeyOperationResult,
  parseSettingsPullResponse,
} from '@growi/chat';
import { DEFAULT_EXPIRES_IN_SEC, sign } from '@growi/chat/server';

import type {
  GrowiUriResolver,
  RelationKeyService,
} from '../relation/index.js';

/**
 * Why a call did not produce an answer this proxy may act on. Deliberately
 * coarse: `FanOutCollector` (task 6.3) reports a failed target to a chat user,
 * and anything finer would describe the proxy's own view of the network to
 * whoever asked (design.md 「管理者に返すのは失敗の種類だけ」).
 */
export type GrowiCallFailure =
  /** The declared URI did not pass judgement on THIS call. */
  | 'uri-refused'
  /**
   * No usable signing key for the relation: either `signerFor` refused (no
   * valid key, or several valid ones that do not say which is in charge -- two
   * valid keys ARE the normal mid-rotation state and are not refused), or the
   * key material it handed back is not
   * one `sign()` will sign with (nothing validates the stored key's type on
   * the way in or out of `own_key`, so a corrupted row for ONE relation
   * arrives here).
   */
  | 'no-signing-key'
  /** The destination never finished answering. */
  | 'unreachable'
  /** A non-2xx status: the transport failed, so the body means nothing. */
  | 'http-error'
  /** An answer that is not JSON, or does not have the shape it claims. */
  | 'malformed-response';

export type GrowiCallResult<T> =
  | { readonly ok: true; readonly response: T }
  | { readonly ok: false; readonly reason: GrowiCallFailure };

export interface GrowiClient {
  sendCommand(
    growiUri: string,
    request: CommandRequest,
  ): Promise<GrowiCallResult<CommandResponse>>;
  startAccountLink(
    growiUri: string,
    request: AccountLinkStartRequest,
  ): Promise<GrowiCallResult<AccountLinkStartResponse>>;
  /**
   * Re-fetches the relation's settings. The fallback for a `settings-push`
   * that never arrived (Requirement 11.4), which is why it is a proxy-initiated
   * op at all.
   */
  pullSettings(
    growiUri: string,
    relationId: string,
  ): Promise<GrowiCallResult<SettingsPullResponse>>;
  registerKey(
    growiUri: string,
    request: KeyRegistrationRequest,
  ): Promise<GrowiCallResult<KeyOperationResult>>;
  revokeKey(
    growiUri: string,
    request: KeyRevocationRequest,
  ): Promise<GrowiCallResult<KeyOperationResult>>;
}

export interface GrowiClientDeps {
  readonly uriResolver: GrowiUriResolver;
  /**
   * Only the signing half is taken: this module never issues, rotates or
   * revokes a key, and naming exactly what it uses keeps task 6.2's additions
   * to `RelationKeyService` from silently becoming reachable from here.
   */
  readonly keyService: Pick<RelationKeyService, 'signerFor'>;
  /** See `DEFAULT_EXPIRES_IN_SEC`; the peer caps whatever it is handed. */
  readonly expiresInSec?: number;
}

const CONTENT_TYPE = 'application/json';
const GROWI_URI_PLACEHOLDER = '{growiUri}';

/**
 * What every `parse*` function answers with when the shape does not hold.
 *
 * The check below is on the PRESENCE of an `error` field, never on its value.
 * `@growi/chat` declares its `ParseError` union privately in each parse module
 * (`parse-command.ts` carries `'malformed' | 'unknown-kind'`, the others only
 * `'malformed'`) and exports none of them, so any list written out here would
 * be a hand-copied duplicate -- and a hand-copied list is fail-OPEN: a value
 * outside it would be read as "not an error" and a broken parse would be
 * handed to a caller as a successful answer carrying the parse's own error
 * object. No successful answer this module ever receives (`CommandResponse`'s
 * non-error variants -- whose own refusal variant keys on `kind`/`code`, not
 * `error` --, `KeyOperationResult`, `AccountLinkStartResponse`,
 * `SettingsPullResponse`) has a field named `error`, which is what makes the
 * presence check exact rather than merely safe. The five-op `it.each` block in
 * the spec is the standing guard on that: it feeds a valid success answer for
 * every op and demands `ok: true`, so a success type that ever gained an
 * `error` field would turn it red.
 */
type ParseError = { readonly error: unknown };
type Parse<T> = (raw: unknown) => T | ParseError;

const isParseError = <T extends object>(
  parsed: T | ParseError,
): parsed is ParseError => 'error' in parsed;

/**
 * The path one op is served on, read from the shared routing table rather than
 * written out again here.
 *
 * `{growiUri}` is **stripped, not substituted**: `PinnedConnection.send` reads
 * `request.path` relative to the GROWI URI's own path (task 5.1's note), so it
 * applies the base itself. Substituting the real URI would both hand the base
 * path in twice and write a whole URL where a path belongs.
 */
const pathForOp = (op: OpName): string => {
  const descriptor = OP_ENDPOINTS[op];
  if (descriptor.direction !== 'proxy-to-growi') {
    throw new Error(
      `Cannot call ${op} on a GROWI: it is served by the proxy, not by GROWI.`,
    );
  }
  if (!descriptor.pathTemplate.startsWith(GROWI_URI_PLACEHOLDER)) {
    throw new Error(
      `The endpoint declared for ${op} does not start with ${GROWI_URI_PLACEHOLDER}: ${descriptor.pathTemplate}`,
    );
  }
  return descriptor.pathTemplate.slice(GROWI_URI_PLACEHOLDER.length);
};

export const createGrowiClient = (deps: GrowiClientDeps): GrowiClient => {
  const {
    uriResolver,
    keyService,
    expiresInSec = DEFAULT_EXPIRES_IN_SEC,
  } = deps;

  // Checked here rather than per call, because it is a GLOBAL wiring value:
  // it is captured once and cannot differ between relations or between calls.
  // Folding it into the per-call failure path would report every destination
  // as "no usable signing key" and hide one mistyped configuration value
  // behind a whole federation going quiet; failing at construction puts the
  // complaint where the wrong value was written. (`sign()` would reject it
  // too, but not until the first call, and only as an exception.)
  if (!Number.isInteger(expiresInSec) || expiresInSec <= 0) {
    throw new RangeError(
      `expiresInSec must be a positive whole number of seconds, got ${expiresInSec}`,
    );
  }

  // `T` is always given explicitly at the call sites below. Left to
  // inference it would absorb the parse function's own error variant
  // (`T = CommandResponse | ParseError`), and an unparseable answer would
  // typecheck its way back out to the caller as a successful response.
  const call = async <T extends object>(
    growiUri: string,
    body: RequestEnvelope,
    parse: Parse<T>,
  ): Promise<GrowiCallResult<T>> => {
    const path = pathForOp(body.op);

    // Judged first, so a refused URI costs neither a key read nor a request.
    const connection = await uriResolver.connect(growiUri);
    if (!connection.ok) {
      return { ok: false, reason: 'uri-refused' };
    }

    // Serialized ONCE: `payload` is both what is hashed and what is sent.
    const payload = JSON.stringify(body);
    const headers = { 'content-type': CONTENT_TYPE };

    // Fetching the key and signing with it are ONE step for the purpose of
    // reporting, because both fail for the same reason -- this relation has no
    // key material this proxy can sign with -- and both are per-relation.
    // `signerFor` throws when a relation has no usable key or more than one;
    // `sign()` throws when the private key it is handed is not Ed25519, and
    // nothing on the way into or out of `own_key.private_key_pem` checks that
    // (`loadSigner` just decrypts the stored PEM into a `KeyObject`), so one
    // corrupted row reaches here. Task 6.3's fan-out must never see an
    // exception from any single target, so both become the same value.
    let signed: ReturnType<typeof sign>;
    try {
      const signer = await keyService.signerFor(body.relationId);
      signed = sign({
        method: 'POST',
        headers,
        body: Buffer.from(payload, 'utf8'),
        key: signer.key,
        privateKey: signer.privateKey,
        expiresInSec,
      });
    } catch {
      return { ok: false, reason: 'no-signing-key' };
    }

    let response: Awaited<ReturnType<typeof connection.send>>;
    try {
      response = await connection.send({
        method: 'POST',
        path,
        // `content-type` is a covered component, so the header the signature
        // was built over and the header on the wire must be the same one.
        headers: { ...headers, ...signed.headers },
        body: payload,
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }

    if (response.status < 200 || response.status >= 300) {
      // An op GROWI turns down still answers 2xx with a rejection in the body
      // (`KeyOperationResult`), so a non-2xx status is the transport failing
      // and its body is whatever an intermediary chose to write.
      return { ok: false, reason: 'http-error' };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(response.body);
    } catch {
      return { ok: false, reason: 'malformed-response' };
    }

    const parsed = parse(raw);
    if (isParseError(parsed)) {
      return { ok: false, reason: 'malformed-response' };
    }
    return { ok: true, response: parsed };
  };

  return {
    sendCommand: (growiUri, request) =>
      call<CommandResponse>(
        growiUri,
        { ...request, op: OP_NAMES.command },
        parseCommandResponse,
      ),

    startAccountLink: (growiUri, request) =>
      call<AccountLinkStartResponse>(
        growiUri,
        { ...request, op: OP_NAMES.accountLinkStart },
        parseAccountLinkStartResponse,
      ),

    pullSettings: (growiUri, relationId) => {
      const request: OpOnlyRequest = {
        relationId,
        op: OP_NAMES.settingsPull,
      };
      return call<SettingsPullResponse>(
        growiUri,
        request,
        parseSettingsPullResponse,
      );
    },

    registerKey: (growiUri, request) =>
      call<KeyOperationResult>(
        growiUri,
        { ...request, op: OP_NAMES.keyRegisterToGrowi },
        parseKeyOperationResult,
      ),

    revokeKey: (growiUri, request) =>
      call<KeyOperationResult>(
        growiUri,
        { ...request, op: OP_NAMES.keyRevokeToGrowi },
        parseKeyOperationResult,
      ),
  };
};
