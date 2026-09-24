// The proxy's outermost guard: every request GROWI signs passes through here
// before any endpoint sees it (design.md's `SignatureGuard`, Requirements
// 10.1-10.4, 10.7).
//
// **It stands in front of the endpoints instead of inside each of them** for
// one reason: how the raw bytes are read, how long a request stays valid, when
// the one-time value is spent, and what a refusal records are four decisions
// that would otherwise be made eight times over, and one endpoint deciding any
// of them loosely is enough to lose the guarantee for the whole proxy.
//
// Three properties are worth reading before changing anything here.
//
//  - **The body is taken as bytes** (`c.req.arrayBuffer()`), never through
//    `c.req.json()`. The signature covers the `content-digest` header, whose
//    value is a hash of the bytes that were sent; bytes rebuilt from a parsed
//    value differ in key order and number formatting, so a legitimate peer
//    would be refused. The value handed to the endpoint behind this guard is
//    parsed from those same bytes, once, and put on the request context.
//  - **This is a thin wrapper around `@growi/chat`'s `verify()`.** The
//    300-second cap on a request's validity, the order (digest and signature
//    first, `consumeNonce` last), and the failure vocabulary all live in that
//    function -- shared by both sides of the protocol on purpose. Re-deriving
//    any of them here would create a second place for the two sides to
//    disagree. This file only supplies the request, reacts to the answer, and
//    adds the envelope cross-check `verify()` cannot make.
//  - **A refusal answers an empty 401 and names nothing.** The umbrella spec's
//    Security Considerations require that the detail of a failed verification
//    is not returned to the caller and that the kind stays in the record kept
//    for operators. That record is `recordFailure`; the response says
//    only that the request was refused. The kind is worth withholding because
//    the caller here is by definition unauthenticated: `unknown-key` rather
//    than `signature-mismatch` would let it find out which
//    `(relationId, keyId)` pairs exist, and `replayed` rather than `expired`
//    would tell it what the nonce store holds.

import type { KeyObject } from 'node:crypto';
import { OP_ENDPOINTS, type OpName } from '@growi/chat';
import {
  acceptEnvelope,
  type KeyRef,
  type VerifyFailure,
  verify,
} from '@growi/chat/server';
import type { MiddlewareHandler } from 'hono';

/**
 * What a refused request is recorded with (Requirement 10.2).
 *
 * **There is deliberately no field for the signature or the body.** The
 * umbrella spec's Security Considerations forbid recording either, and a type
 * that cannot carry them makes that a compile error rather than a rule each
 * caller has to remember.
 *
 * The relation is absent for the same structural reason it cannot be here:
 * `verify()` reports no `KeyRef` on a failure, and decoding `keyid` here would
 * mean re-implementing the header parsing `@growi/chat` deliberately keeps to
 * itself.
 */
export interface InboundRequestContext {
  readonly method: string;
  readonly path: string;
  readonly receivedAt: Date;
}

export interface SignatureGuardDeps {
  /**
   * The peer's public key for this reference, or `null` when there is none to
   * use. **Never this proxy's own key**: a request signed with our own key
   * would otherwise verify against it and a reflected key-registration would
   * succeed. `peer-key-repository` holds only the peer's keys, which is what
   * makes that structural.
   */
  readonly resolvePublicKey: (ref: KeyRef) => Promise<KeyObject | null>;
  /** `false` the second time the same value is presented (`request-nonce-repository`). */
  readonly consumeNonce: (
    ref: KeyRef,
    nonce: string,
    expiresAt: Date,
  ) => Promise<boolean>;
  readonly recordFailure: (
    failure: VerifyFailure,
    ctx: InboundRequestContext,
  ) => Promise<void>;
}

/** What an endpoint behind this guard reads off the request. */
export interface SignedRequestVariables {
  /** The relation and key the signature proved, never a value from the body. */
  verifiedKey: KeyRef;
  /**
   * The body parsed from the verified bytes. Still `unknown`: which parse
   * function turns it into a typed request is the endpoint's own business
   * (design.md's op table), and this guard has no business picking one.
   */
  verifiedBody: unknown;
}

export type SignedRequestEnv = { Variables: SignedRequestVariables };

/**
 * Which op each GROWI-facing path serves.
 *
 * **Derived from the protocol package's endpoint table, not declared again
 * here.** The usual rule in `.claude/rules/coding-style.md` is that an
 * executor takes its work-set as a parameter, and it is set aside on purpose:
 * these paths are the protocol's property, shared by both sides, so no caller
 * could legitimately supply a different table -- while a caller-supplied one
 * would reopen exactly the hole design.md closes here, an endpoint registered
 * with its neighbour's op by a slip of the hand.
 *
 * The unsigned pairing submission is absent because it carries no `op` at all.
 */
export const INBOUND_OP_BY_PATH: ReadonlyMap<string, OpName> = new Map(
  Object.values(OP_ENDPOINTS)
    .filter((endpoint) => endpoint.direction === 'growi-to-proxy')
    .map((endpoint) => [
      endpoint.pathTemplate.replace('{proxyUri}', ''),
      endpoint.op,
    ]),
);

/**
 * The path the protocol's endpoint table gives this op.
 *
 * Reversed out of `INBOUND_OP_BY_PATH` rather than written out again: that map
 * is what the guard consults, so deriving from it is what keeps a route and
 * the op its guard expects from ever naming different paths. A hand-written
 * path with a typo would not fail loudly -- the guard refuses any path the
 * table does not name, so the endpoint would serve 401s with no visible cause.
 *
 * It lives here, beside the table, because every GROWI-facing route module
 * needs it; keeping it private to one of them would have the next one copy it.
 */
export const pathForOp = (op: OpName): string => {
  for (const [path, name] of INBOUND_OP_BY_PATH) {
    if (name === op) {
      return path;
    }
  }
  throw new Error(`no GROWI-facing endpoint is declared for op '${op}'`);
};

interface Envelope {
  readonly relationId: string;
  readonly op: OpName;
}

interface VerifiedBody {
  /** The whole parsed value, handed to the endpoint's own parse function. */
  readonly value: unknown;
  /** The two fields `acceptEnvelope` compares. */
  readonly envelope: Envelope;
}

const isOpName = (value: string): value is OpName => value in OP_ENDPOINTS;

/**
 * The envelope fields `acceptEnvelope` compares, read from the verified bytes.
 *
 * Narrowing only: the endpoint's own parse function is what validates a body,
 * and the `op` check below decides nothing on its own -- a value that is not
 * an op name cannot equal the endpoint's op either way.
 */
const readVerifiedBody = (body: Uint8Array): VerifiedBody | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const { relationId, op } = parsed as Record<string, unknown>;
  if (typeof relationId !== 'string' || typeof op !== 'string') {
    return null;
  }
  return isOpName(op) ? { value: parsed, envelope: { relationId, op } } : null;
};

/**
 * Checks the RFC 9421 signature on every request GROWI sends, and refuses the
 * ones that do not hold up.
 */
export const signatureGuard = (
  deps: SignatureGuardDeps,
): MiddlewareHandler<SignedRequestEnv> => {
  const { resolvePublicKey, consumeNonce, recordFailure } = deps;

  return async (c, next) => {
    const ctx: InboundRequestContext = {
      method: c.req.method,
      path: c.req.path,
      receivedAt: new Date(),
    };

    const refuse = async (failure: VerifyFailure) => {
      try {
        await recordFailure(failure, ctx);
      } catch {
        // A record that cannot be written must not turn a refusal into a
        // 500 -- the request still has to be refused.
      }
      return c.body(null, 401);
    };

    // Which endpoint was reached is read from the table, never written into a
    // handler: two endpoints given the same op by hand would let one
    // endpoint's signature be spent on the other.
    const endpointOp = INBOUND_OP_BY_PATH.get(c.req.path);
    if (endpointOp == null) {
      return refuse('malformed');
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    const result = await verify({
      method: c.req.method,
      headers: c.req.header(),
      body,
      resolvePublicKey,
      consumeNonce,
    });
    if (!result.ok) {
      return refuse(result.failure);
    }

    // The nonce is already spent by now -- `verify()` consumes it as its last
    // step -- so a cross-check failure below refuses a request whose one-time
    // value is gone. That is the intended outcome: the bytes were validly
    // signed, and re-sending the same bytes must not be accepted either.
    const parsed = readVerifiedBody(body);
    if (parsed == null) {
      return refuse('malformed');
    }
    const accepted = acceptEnvelope(parsed.envelope, result.key, endpointOp);
    if (!accepted.ok) {
      return refuse(accepted.failure);
    }

    c.set('verifiedKey', result.key);
    // The value parsed from the verified bytes, parsed once: parsing again
    // downstream would be a second chance for the two to differ.
    c.set('verifiedBody', parsed.value);
    await next();
  };
};
