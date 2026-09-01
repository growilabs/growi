// A minimal in-memory stand-in for the two sides of the pairing procedure
// (design.md "ペアリング — 申告された URL の扱い", 手順（①〜⑥）; Requirement
// 9.1, 9.5).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE. Nothing here is re-exported
// from `src/index.ts` or `src/server.ts`, and the package's `exports` map has
// no wildcard subpath, so no other package can reach this module.
//
// Both roles are played with `@growi/chat`'s own public entry points only
// (`../index.js` for the contract types and the wire-shape checks,
// `../server.js` for `pairingChallengePayload`). The only thing taken from
// outside the package is `node:crypto`, and only for what this package
// deliberately does NOT own:
//   - generating test key material (`generateKeyPairSync`), and
//   - the raw Ed25519 signing/verification of pairing step 5.
// Step 5 is the one exchange that happens BEFORE any key is registered, so it
// is not an RFC 9421 signed request at all: `sign`/`verify` (and their
// covered components, nonce, and expiry machinery) have nothing to act on
// here. What step 5 signs is exactly the string `pairingChallengePayload`
// composes, and nothing else -- see `answerOwnershipChallenge` below.
//
// Storage is a plain `Map` on purpose: how each side actually persists this
// state belongs to the app-side and proxy-side sub-specs, not to this
// package. The maps here are mutated in place (unlike the rest of this
// package, which is immutable) because they stand in for a database, and
// mutation is confined to the exported functions below.
//
// The pieces are exported one per step so a later task can intercept or
// tamper at any point in the procedure; `runPairing` at the bottom is a
// convenience that composes them, not the only way in.

import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign as nodeSign,
  verify as nodeVerify,
  randomBytes,
  randomUUID,
} from 'node:crypto';

import {
  type OwnershipChallenge,
  type PairingResult,
  type PairingSubmission,
  type PlatformName,
  type PublicKeyRegistration,
  parseChallengeResponse,
  parseOwnershipChallenge,
  parsePairingResult,
  parsePairingSubmission,
} from '../index.js';
import { pairingChallengePayload } from '../server.js';

/** How long an issued registration code stays usable, unless overridden. */
export const DEFAULT_REGISTRATION_TTL_SEC = 600;

/**
 * One side's own signing key. The private half never leaves this object --
 * it is never put on a wire type and never stored as a peer key.
 */
export interface OwnKey {
  readonly keyId: string;
  readonly validFrom: string;
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
}

/**
 * What a side holds once pairing has completed.
 *
 * `ownKey` and `peerPublicKey` are SEPARATE fields on purpose: `KeyRef`
 * carries no own/peer axis (tasks.md Implementation Note 2.4, design.md's
 * `VerifyParams.resolvePublicKey` note), so keeping the two apart is each
 * side's storage's job -- which is exactly what this record models.
 */
export interface RelationRecord {
  readonly relationId: string;
  readonly ownKey: OwnKey;
  readonly peerPublicKey: PublicKeyRegistration;
  /** The verified GROWI URI. Only the proxy side has one; GROWI stores null. */
  readonly peerUri: string | null;
}

/** proxy-side state for a registration code that has been issued (step 1). */
export interface PendingRegistration {
  readonly registrationCode: string;
  readonly expiresAt: Date;
  /** Filled in at step 3, once a submission naming this code arrives. */
  readonly submission: PairingSubmission | null;
}

export interface ProxySide {
  readonly workspace: {
    readonly platform: PlatformName;
    readonly workspaceId: string;
    readonly workspaceName: string;
  };
  readonly ownKey: OwnKey;
  readonly pending: Map<string, PendingRegistration>;
  readonly relations: Map<string, RelationRecord>;
}

export interface GrowiSide {
  readonly growiUri: string;
  readonly growiLabel: string;
  readonly ownKey: OwnKey;
  /** GROWI holds at most one pending registration code at a time (step 2). */
  pendingRegistration: {
    readonly registrationCode: string;
    readonly expiresAt: Date;
  } | null;
  readonly relations: Map<string, RelationRecord>;
}

/**
 * What step 4 gets back from the declared URI. Modelled as a status plus a
 * body rather than a parsed value, because the statuses design.md names for
 * step 5 (401 on a code mismatch, 410 once the pending registration has
 * expired) are part of what the procedure has to distinguish, and 404 stands
 * for "no GROWI answers at that URI at all".
 */
export type ChallengeAnswer =
  | { readonly status: 200; readonly body: unknown }
  | { readonly status: 400 | 401 | 404 | 410 };

/**
 * Step 4's transport. Injected rather than hard-wired to the GROWI that
 * submitted, so a caller can point the challenge at any side it likes --
 * which is what proving "the declared URI is checked, not assumed" requires.
 */
export type DeliverChallenge = (
  growiUri: string,
  body: unknown,
) => ChallengeAnswer;

export type SubmissionReceipt =
  | { readonly accepted: true; readonly submission: PairingSubmission }
  | {
      readonly accepted: false;
      readonly reason: 'malformed' | 'unknown-code' | 'code-expired';
    };

export type ResultReceipt =
  | { readonly accepted: true; readonly relationId: string }
  | {
      readonly accepted: false;
      readonly reason: 'malformed' | 'not-paired' | 'relation-already-known';
    };

export interface TimeOptions {
  readonly now?: Date;
  readonly ttlSec?: number;
}

const nowOf = (options?: TimeOptions): Date => options?.now ?? new Date();

const expiryFrom = (now: Date, options?: TimeOptions): Date =>
  new Date(
    now.getTime() + (options?.ttlSec ?? DEFAULT_REGISTRATION_TTL_SEC) * 1000,
  );

/** Shaped to pass `isValidKeyIdShape` (`/^[A-Za-z0-9_-]{8,64}$/`). */
const generateKeyId = (prefix: string): string =>
  `${prefix}-${randomBytes(9).toString('base64url')}`;

export const createOwnKey = (keyId: string, validFrom?: string): OwnKey => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    validFrom: validFrom ?? new Date(0).toISOString(),
    publicKey,
    privateKey,
  };
};

/**
 * The wire form of a side's own key. Exported from the PUBLIC half of the key
 * pair, so the JWK never carries the private component `d` --
 * `isValidPublicKeyMaterial` (reached through every parse* function that
 * handles a `PublicKeyRegistration`) rejects one that does.
 */
export const publicKeyRegistrationOf = (
  ownKey: OwnKey,
): PublicKeyRegistration => ({
  keyId: ownKey.keyId,
  publicKeyJwk: ownKey.publicKey.export({ format: 'jwk' }),
  validFrom: ownKey.validFrom,
});

/**
 * Turns a stored peer registration back into a key usable for verification.
 * Throws on key material that is not a usable public key -- callers reach
 * this only after a parse* function has already judged the material.
 */
export const toPublicKeyObject = (
  registration: PublicKeyRegistration,
): KeyObject =>
  // Spread into a fresh object: the contract's `JsonWebKey` and the one
  // `node:crypto` accepts are two different declarations of the same shape,
  // and only the anonymous spread result is assignable to both.
  createPublicKey({ key: { ...registration.publicKeyJwk }, format: 'jwk' });

export const createProxySide = (options?: {
  readonly keyId?: string;
  readonly workspace?: ProxySide['workspace'];
}): ProxySide => ({
  workspace: options?.workspace ?? {
    platform: 'slack',
    workspaceId: 'T0123456789',
    workspaceName: 'example-workspace',
  },
  ownKey: createOwnKey(options?.keyId ?? generateKeyId('proxy')),
  pending: new Map(),
  relations: new Map(),
});

export const createGrowiSide = (options: {
  readonly growiUri: string;
  readonly growiLabel?: string;
  readonly keyId?: string;
}): GrowiSide => ({
  growiUri: options.growiUri,
  growiLabel: options.growiLabel ?? 'Example GROWI',
  ownKey: createOwnKey(options.keyId ?? generateKeyId('growi')),
  pendingRegistration: null,
  relations: new Map(),
});

/**
 * Step 1. proxy issues a registration code. This is an out-of-band chat admin
 * command, so it has no wire type at all -- the code is purely proxy-internal
 * state until the admin carries it over to GROWI by hand.
 */
export const issueRegistrationCode = (
  proxy: ProxySide,
  options?: TimeOptions & { readonly registrationCode?: string },
): string => {
  const now = nowOf(options);
  // >= 128 bits of randomness (design.md's pairing rationale).
  const registrationCode =
    options?.registrationCode ?? randomBytes(24).toString('base64url');

  proxy.pending.set(registrationCode, {
    registrationCode,
    expiresAt: expiryFrom(now, options),
    submission: null,
  });

  return registrationCode;
};

/** Step 2. The admin pastes the code into GROWI, which holds it pending. */
export const holdPendingRegistration = (
  growi: GrowiSide,
  registrationCode: string,
  options?: TimeOptions,
): void => {
  const now = nowOf(options);
  growi.pendingRegistration = {
    registrationCode,
    expiresAt: expiryFrom(now, options),
  };
};

/**
 * Step 3, sending side. GROWI submits its own PUBLIC key together with the
 * pending code and the URI it declares for itself.
 */
export const buildPairingSubmission = (growi: GrowiSide): PairingSubmission => {
  if (growi.pendingRegistration == null) {
    throw new Error(
      'buildPairingSubmission: no pending registration to submit',
    );
  }

  return {
    registrationCode: growi.pendingRegistration.registrationCode,
    growiUri: growi.growiUri,
    growiLabel: growi.growiLabel,
    publicKey: publicKeyRegistrationOf(growi.ownKey),
  };
};

/**
 * Step 3, receiving side. The body is UNSIGNED (no key exists yet), so the
 * shape check plus the pending registration code are the whole gate here.
 */
export const receivePairingSubmission = (
  proxy: ProxySide,
  raw: unknown,
  options?: TimeOptions,
): SubmissionReceipt => {
  const parsed = parsePairingSubmission(raw);
  if ('error' in parsed) {
    return { accepted: false, reason: 'malformed' };
  }

  const pending = proxy.pending.get(parsed.registrationCode);
  if (pending == null) {
    return { accepted: false, reason: 'unknown-code' };
  }
  if (nowOf(options).getTime() > pending.expiresAt.getTime()) {
    return { accepted: false, reason: 'code-expired' };
  }

  proxy.pending.set(pending.registrationCode, {
    ...pending,
    submission: parsed,
  });

  return { accepted: true, submission: parsed };
};

/**
 * Step 5. GROWI's ownership-confirmation endpoint.
 *
 * Answers ONLY while the pending registration code matches -- otherwise any
 * GROWI running Gen 2 would answer any challenge, and step 4 would prove
 * nothing beyond "some Gen 2 GROWI lives at that URI" (design.md
 * "⑤ に条件が要る理由", Requirement 9.2).
 *
 * The signature is made over `pairingChallengePayload(<the code THIS side
 * holds>, challenge)` -- built here from GROWI's own pending registration,
 * never from anything the caller supplied beyond the challenge itself, so a
 * mismatch between the two sides' idea of the code cannot be papered over.
 * The bare `challenge` is deliberately never signed (design.md
 * "⑤ で署名する値"). `base64url` encoding is required by
 * `ChallengeResponse`'s shape check.
 */
export const answerOwnershipChallenge = (
  growi: GrowiSide,
  raw: unknown,
  options?: TimeOptions,
): ChallengeAnswer => {
  const parsed = parseOwnershipChallenge(raw);
  if ('error' in parsed) {
    return { status: 400 };
  }

  const pending = growi.pendingRegistration;
  if (pending == null || pending.registrationCode !== parsed.registrationCode) {
    return { status: 401 };
  }
  if (nowOf(options).getTime() > pending.expiresAt.getTime()) {
    return { status: 410 };
  }

  const payload = pairingChallengePayload(
    pending.registrationCode,
    parsed.challenge,
  );
  const challengeSignature = nodeSign(
    null,
    Buffer.from(payload, 'utf8'),
    growi.ownKey.privateKey,
  ).toString('base64url');

  return {
    status: 200,
    body: { challenge: parsed.challenge, challengeSignature },
  };
};

/**
 * The default step-4 transport: resolves the declared URI against a set of
 * GROWI sides and calls that side's step-5 handler directly. A URI no side
 * claims answers 404.
 */
export const createChallengeDelivery = (
  growiSides: readonly GrowiSide[],
  options?: TimeOptions,
): DeliverChallenge => {
  return (growiUri, body) => {
    const side = growiSides.find(
      (candidate) => candidate.growiUri === growiUri,
    );
    if (side == null) {
      return { status: 404 };
    }
    return answerOwnershipChallenge(side, body, options);
  };
};

export interface CompletePairingParams extends TimeOptions {
  readonly registrationCode: string;
  readonly deliverChallenge: DeliverChallenge;
  /** Generated fresh when omitted; overridable so a caller can pin it. */
  readonly challenge?: string;
}

const unverified = (detail: string): PairingResult => ({
  status: 'ownership-unverified',
  detail,
});

/**
 * Steps 4 and 6. proxy challenges the DECLARED URI, checks the answer, and
 * only then registers both keys and answers with its own public key and the
 * new `relationId`.
 *
 * The payload the signature is checked against is rebuilt here from the code
 * proxy itself issued -- independently of the string GROWI signed, so the
 * test proves the two sides agree rather than sharing one computed value.
 */
export const completePairing = (
  proxy: ProxySide,
  params: CompletePairingParams,
): PairingResult => {
  const now = nowOf(params);
  const pending = proxy.pending.get(params.registrationCode);

  if (pending == null || now.getTime() > pending.expiresAt.getTime()) {
    proxy.pending.delete(params.registrationCode);
    return { status: 'code-expired' };
  }

  const { submission } = pending;
  if (submission == null) {
    return unverified('no pairing submission received for this code');
  }

  const alreadyPaired = [...proxy.relations.values()].find(
    (relation) => relation.peerUri === submission.growiUri,
  );
  if (alreadyPaired != null) {
    return {
      status: 'already-paired',
      detail: `already paired with ${submission.growiUri} as ${alreadyPaired.relationId}`,
    };
  }

  // base64url, 43 chars -- inside `OwnershipChallenge`'s 32..128 range.
  const challenge = params.challenge ?? randomBytes(32).toString('base64url');
  const challengeBody: OwnershipChallenge = {
    registrationCode: pending.registrationCode,
    challenge,
  };

  const answer = params.deliverChallenge(submission.growiUri, challengeBody);
  if (answer.status !== 200) {
    return unverified(`ownership confirmation answered ${answer.status}`);
  }

  const response = parseChallengeResponse(answer.body);
  if ('error' in response) {
    return unverified('malformed challenge response');
  }
  if (response.challenge !== challenge) {
    return unverified('challenge mismatch');
  }

  const expectedPayload = pairingChallengePayload(
    pending.registrationCode,
    challenge,
  );
  // The public key checked against is the one submitted at step 3 -- that is
  // what binds "whoever answered" to "whoever's key gets registered"
  // (Requirement 9.5).
  const signatureIsValid = (() => {
    try {
      return nodeVerify(
        null,
        Buffer.from(expectedPayload, 'utf8'),
        toPublicKeyObject(submission.publicKey),
        Buffer.from(response.challengeSignature, 'base64url'),
      );
    } catch {
      return false;
    }
  })();
  if (!signatureIsValid) {
    return unverified('challenge signature did not verify');
  }

  const relationId = `relation-${randomUUID()}`;
  proxy.relations.set(relationId, {
    relationId,
    ownKey: proxy.ownKey,
    peerPublicKey: submission.publicKey,
    peerUri: submission.growiUri,
  });
  // The code is single-use: it is spent by the pairing it completed.
  proxy.pending.delete(pending.registrationCode);

  return {
    status: 'paired',
    relationId,
    workspace: proxy.workspace,
    publicKey: publicKeyRegistrationOf(proxy.ownKey),
  };
};

/**
 * Step 6, receiving side. GROWI stores proxy's public key under the
 * `relationId` proxy assigned.
 *
 * A `relationId` GROWI already knows is refused rather than overwritten: the
 * identifier is chosen by the far side, so accepting a repeat would let a
 * second proxy replace the key of an existing relation (Requirement 10.6).
 */
export const receivePairingResult = (
  growi: GrowiSide,
  raw: unknown,
): ResultReceipt => {
  const parsed = parsePairingResult(raw);
  if ('error' in parsed) {
    return { accepted: false, reason: 'malformed' };
  }
  if (parsed.status !== 'paired') {
    return { accepted: false, reason: 'not-paired' };
  }
  if (growi.relations.has(parsed.relationId)) {
    return { accepted: false, reason: 'relation-already-known' };
  }

  growi.relations.set(parsed.relationId, {
    relationId: parsed.relationId,
    ownKey: growi.ownKey,
    peerPublicKey: parsed.publicKey,
    peerUri: null,
  });
  growi.pendingRegistration = null;

  return { accepted: true, relationId: parsed.relationId };
};

export interface PairingRun {
  readonly registrationCode: string;
  readonly submission: PairingSubmission;
  readonly submissionReceipt: SubmissionReceipt;
  readonly result: PairingResult;
  readonly resultReceipt: ResultReceipt;
}

/**
 * Convenience composition of all six steps over a single proxy/GROWI pair.
 * Every step is also exported on its own above, so a caller that needs to
 * intervene mid-procedure does not have to go through this function.
 */
export const runPairing = (
  proxy: ProxySide,
  growi: GrowiSide,
  options?: TimeOptions & {
    readonly deliverChallenge?: DeliverChallenge;
    readonly challenge?: string;
  },
): PairingRun => {
  const registrationCode = issueRegistrationCode(proxy, options);
  holdPendingRegistration(growi, registrationCode, options);

  const submission = buildPairingSubmission(growi);
  const submissionReceipt = receivePairingSubmission(
    proxy,
    submission,
    options,
  );

  const result = completePairing(proxy, {
    registrationCode,
    deliverChallenge:
      options?.deliverChallenge ?? createChallengeDelivery([growi], options),
    now: options?.now,
    challenge: options?.challenge,
  });
  const resultReceipt = receivePairingResult(growi, result);

  return {
    registrationCode,
    submission,
    submissionReceipt,
    result,
    resultReceipt,
  };
};
