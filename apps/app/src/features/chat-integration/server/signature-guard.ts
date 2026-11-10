// The check every request the chat-integration proxy signs goes through
// before any endpoint of this feature sees it (design.md's `SignatureGuard`,
// Requirements 10.1-10.4, 10.7).
//
// **It stands in front of the endpoints rather than inside each of them.**
// How the raw bytes are read, how long a request may stay valid, when the
// one-time value is spent, what a refusal records, and how the body's
// envelope is cross-checked are five decisions that would otherwise be taken
// again at each of the five signed endpoints -- and one endpoint taking any of
// them loosely is enough to lose the guarantee for the whole feature (task
// 3.2: "口を作る作業より先に置く").
//
// Three properties are worth reading before changing anything here.
//
//  - **The body is verified as the bytes that arrived.** `express.raw` puts
//    those bytes on `req.body` as a `Buffer` under the peer prefix (task 2.1,
//    `server/crowi/express-init.js`), and they are handed to `verify()`
//    untouched. The signature covers the *value* of the `content-digest`
//    header, which is a hash of the bytes the sender sent; bytes rebuilt from
//    a parsed value differ in key order and number formatting, so a
//    legitimate peer would be refused. `JSON.parse` runs once, here, on those
//    same verified bytes, and the parsed value is what the endpoint reads.
//  - **This is a thin wrapper around `@growi/chat`'s `verify()`.** The cap on
//    how long a request may claim to be valid
//    (`MAX_ACCEPTED_EXPIRES_IN_SEC`), the order of the checks (signature and
//    digest first, `consumeNonce` last), and the vocabulary of failures all
//    live in that function, shared by both sides of the protocol on purpose.
//    Re-deriving any of them here would create a second place for the two
//    sides to disagree. In particular the expiry the nonce record is filed
//    under is the receiver-capped one **because `verify()` is the caller of
//    `consumeNonce`** -- reading `expires` off the header here and capping it
//    again would put the protocol's number in two places (task 3.2:
//    "使い捨ての値に渡す期限は受ける側が上限で切った値").
//  - **A refusal answers an empty 401 and names nothing.** The umbrella
//    spec's Security Considerations keep the detail of a failed verification
//    out of the response and in the record kept for operators. The caller
//    here is by definition unauthenticated: `unknown-key` rather than
//    `signature-mismatch` would let it find out which `(relationId, keyId)`
//    pairs exist, and `replayed` rather than `expired` would tell it what the
//    nonce store holds.

import type { KeyObject } from 'node:crypto';
import {
  OP_NAMES,
  parseAccountLinkStart,
  parseCommandRequest,
  parseKeyRegistration,
  parseKeyRevocation,
  parseOpEnvelope,
} from '@growi/chat';
import {
  acceptEnvelope,
  type KeyRef,
  type VerifyFailure,
  verify,
} from '@growi/chat/server';
import type { Request, RequestHandler } from 'express';

import loggerFactory from '~/utils/logger';

import { resolvePeerKey } from './keys';
import { ChatRequestNonce } from './models/chat-request-nonce';

const logger = loggerFactory('growi:features:chat-integration:signature-guard');

/**
 * What a check function answers with when it refuses the body. Matched by the
 * `error` field being present rather than by its exact values: `parse*`
 * functions do not all use the same vocabulary (`parseCommandRequest` also
 * answers `'unknown-kind'`), and a body type never carries an `error` field,
 * so this separates the two without naming every code.
 */
type ParseFailure = { readonly error: string };

/**
 * The contract check function for each op the proxy sends to GROWI
 * (design.md's op table). **The guard runs it itself**, rather than handing
 * the endpoint an unchecked value: `acceptEnvelope` compares a typed body,
 * and leaving the check to each endpoint is exactly the "口ごとに実装者が
 * 各自で決める" this task exists to prevent. The signature only proves the
 * bytes were not changed in transit -- it says nothing about their shape.
 *
 * The keys of this map ARE the set of ops this guard can serve; the type
 * below is derived from them, and `signature-guard.spec.ts` asserts the set
 * equals the `proxy-to-growi` rows of `OP_ENDPOINTS` so a new inbound op
 * cannot be added to the protocol without landing here.
 *
 * `settings-pull` shares `parseOpEnvelope` with the three read-only ops the
 * proxy serves -- its body is the envelope and nothing else.
 */
const PEER_BODY_PARSERS = {
  [OP_NAMES.command]: parseCommandRequest,
  [OP_NAMES.accountLinkStart]: parseAccountLinkStart,
  [OP_NAMES.settingsPull]: parseOpEnvelope,
  [OP_NAMES.keyRegisterToGrowi]: parseKeyRegistration,
  [OP_NAMES.keyRevokeToGrowi]: parseKeyRevocation,
} as const;

/** An op this guard can be wired to -- one the proxy sends to GROWI. */
export type InboundPeerOp = keyof typeof PEER_BODY_PARSERS;

export const INBOUND_PEER_OPS: ReadonlyArray<InboundPeerOp> = Object.keys(
  PEER_BODY_PARSERS,
) as ReadonlyArray<InboundPeerOp>;

/** What each op's check function hands back once it accepted the body. */
type InboundPeerBodyByOp = {
  [K in InboundPeerOp]: Exclude<
    ReturnType<(typeof PEER_BODY_PARSERS)[K]>,
    ParseFailure
  >;
};

/**
 * The typed body an endpoint receives once its op's check function accepted
 * it.
 *
 * Spelled as a conditional so it distributes: given a union of ops (an
 * endpoint that has not narrowed to one yet, a test harness) a bare
 * `InboundPeerBodyByOp[K]` stays an unresolved lookup and even
 * `relationId` cannot be read off it.
 */
export type InboundPeerBody<K extends InboundPeerOp> = K extends InboundPeerOp
  ? InboundPeerBodyByOp[K]
  : never;

/**
 * Why a request was refused (Requirement 10.2).
 *
 * `@growi/chat`'s own `VerifyFailure` plus the refusals this side makes on its
 * own -- before `verify()` is reached, and after it has answered. `envelope-mismatch` is recorded rather than
 * `acceptEnvelope`'s own `'malformed'`: the two are far apart in what an
 * operator should do about them -- a mismatched envelope is a validly signed
 * request aimed at the wrong endpoint or claiming another relation.
 */
export type RefusalKind =
  | VerifyFailure
  | 'unsupported-media-type'
  | 'body-shape-invalid'
  /**
   * A command naming something this GROWI does not implement -- kept apart
   * from a body that does not hold up at all, because it means the two sides
   * are on different versions rather than that something is wrong with the
   * request.
   */
  | 'unknown-kind'
  | 'envelope-mismatch';

/**
 * What a refused request is recorded with.
 *
 * **There is deliberately no field for the signature or the body.** The
 * umbrella spec's Security Considerations forbid recording either, and a type
 * that cannot carry them makes that a compile error rather than a rule every
 * caller has to remember. The relation is absent for a structural reason as
 * well: `verify()` reports no `KeyRef` on a failure, and decoding `keyid`
 * here would mean re-implementing the header parsing `@growi/chat`
 * deliberately keeps to itself.
 */
export interface InboundRequestContext {
  readonly method: string;
  readonly path: string;
  readonly receivedAt: Date;
}

export interface SignatureGuardDeps {
  /**
   * The peer's public key for this reference, or `null` when there is none to
   * use. Defaults to {@link resolvePeerKey}, which queries `side: 'peer'`
   * only -- that is what keeps a request signed with this GROWI's own key
   * from verifying against it and registering an attacker's key as the
   * peer's.
   */
  readonly resolvePublicKey?: (ref: KeyRef) => Promise<KeyObject | null>;
  /** `false` the second time the same value is presented. Defaults to the `chat_request_nonces` write below. */
  readonly consumeNonce?: (
    ref: KeyRef,
    nonce: string,
    expiresAt: Date,
  ) => Promise<boolean>;
  /** Defaults to a log line. See {@link InboundRequestContext} for what may be recorded. */
  readonly recordFailure?: (
    failure: RefusalKind,
    ctx: InboundRequestContext,
  ) => Promise<void>;
}

/** What an endpoint behind this guard reads off the request. */
export interface VerifiedPeerRequest<K extends InboundPeerOp> extends Request {
  chatPeer: {
    /** The relation and key the signature proved -- never a value read from the body. */
    readonly key: KeyRef;
    /** Parsed from the verified bytes, once, by this op's own check function. */
    readonly body: InboundPeerBody<K>;
  };
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

/**
 * Records the one-time value, and answers `false` when it has been seen
 * before (Requirement 10.4).
 *
 * The unique index on `(relationId, keyId, nonce)` is what decides this, not
 * a read followed by a write: two requests carrying the same nonce can be in
 * flight at once, and a check-then-insert would let both through.
 *
 * `expiresAt` is stored as handed over -- `verify()` passes the expiry it
 * capped itself, and the collection's TTL index drops the record at exactly
 * that instant.
 */
const consumeRequestNonce = async (
  ref: KeyRef,
  nonce: string,
  expiresAt: Date,
): Promise<boolean> => {
  try {
    await ChatRequestNonce.create({
      relationId: ref.relationId,
      keyId: ref.keyId,
      nonce,
      expiresAt,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false;
    }
    // Anything else (the database is unreachable, say) cannot rule out a
    // replay either -- `verify()` turns a throwing `consumeNonce` into a
    // `replayed` refusal, so the request is not processed.
    throw error;
  }
};

const logRefusal = (
  failure: RefusalKind,
  ctx: InboundRequestContext,
): Promise<void> => {
  logger.warn(
    { receivedAt: ctx.receivedAt },
    `A signed request to ${ctx.method} ${ctx.path} was refused: ${failure}`,
  );
  return Promise.resolve();
};

/**
 * The headers in the form `verify()` takes.
 *
 * Node hands back `string | string[] | undefined`; the covered components
 * (`content-type`, `content-digest`) and the signature headers are all
 * single-valued, and a repeated header could not have been signed as a list
 * anyway -- so a non-string value is left out, and the request is refused for
 * the missing header rather than for a shape mismatch.
 */
const stringHeadersOf = (
  headers: Request['headers'],
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[name] = value;
    }
  }
  return result;
};

/**
 * Checks the RFC 9421 signature on every request the proxy sends to one
 * endpoint of this feature, cross-checks the body's envelope against that
 * endpoint, and refuses everything that does not hold up.
 *
 * @param op which endpoint this guard is placed on. The body's own `op` is
 * compared against it, because the signature covers neither the target URL
 * nor the path (a reverse proxy rewrites both), so `op` is the only thing
 * tying a signature to one endpoint.
 * @throws when wired to an op the proxy does not send to GROWI -- a wiring
 * mistake, caught while the routes are being registered rather than as a 500
 * on every request.
 */
export const signatureGuard = (
  op: InboundPeerOp,
  deps: SignatureGuardDeps = {},
): RequestHandler => {
  const parseBody = PEER_BODY_PARSERS[op];
  if (parseBody == null) {
    throw new Error(
      `signatureGuard: '${op}' is not an op the proxy sends to GROWI`,
    );
  }

  const resolvePublicKey = deps.resolvePublicKey ?? resolvePeerKey;
  const consumeNonce = deps.consumeNonce ?? consumeRequestNonce;
  const recordFailure = deps.recordFailure ?? logRefusal;

  return async (req, res, next) => {
    const ctx: InboundRequestContext = {
      method: req.method,
      // `originalUrl`, not `req.path`: once these endpoints hang off a
      // router (task 3.5) `req.path` is only the part below the mount point,
      // and the record has to name the endpoint an operator can find.
      path: req.originalUrl,
      receivedAt: new Date(),
    };

    const refuse = async (failure: RefusalKind): Promise<void> => {
      try {
        await recordFailure(failure, ctx);
      } catch (error) {
        // A record that cannot be written must not turn a refusal into a
        // 500 -- the request still has to be refused.
        logger.error(
          { error },
          'Failed to record a refused chat-integration request',
        );
      }
      res.status(401).end();
    };

    // `Buffer.isBuffer`, not "is the body empty": a request whose
    // `content-type` is `application/x-www-form-urlencoded` slips past
    // `express.raw` and reaches here as the app-wide parser's own object,
    // which is not empty (tasks.md Implementation Notes, task 2.1).
    if (!Buffer.isBuffer(req.body)) {
      await refuse('unsupported-media-type');
      return;
    }
    const bytes = req.body;

    const result = await verify({
      method: req.method,
      headers: stringHeadersOf(req.headers),
      body: bytes,
      resolvePublicKey,
      consumeNonce,
    });
    if (!result.ok) {
      await refuse(result.failure);
      return;
    }

    // From here on the one-time value is already spent -- `verify()` consumes
    // it as its last step -- so the refusals below reject a request whose
    // nonce is gone. That is the intended outcome: the bytes were validly
    // signed, and re-sending them must not be accepted either.
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } catch {
      await refuse('body-shape-invalid');
      return;
    }

    const parsed = parseBody(raw);
    if ('error' in parsed) {
      await refuse(
        parsed.error === 'unknown-kind' ? 'unknown-kind' : 'body-shape-invalid',
      );
      return;
    }

    const accepted = acceptEnvelope(parsed, result.key, op);
    if (!accepted.ok) {
      await refuse('envelope-mismatch');
      return;
    }

    const guarded: VerifiedPeerRequest<InboundPeerOp> =
      req as VerifiedPeerRequest<InboundPeerOp>;
    guarded.chatPeer = { key: result.key, body: accepted.body };
    next();
  };
};
