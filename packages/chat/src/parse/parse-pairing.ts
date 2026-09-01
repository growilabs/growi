// Confirms the wire shape of the two UNSIGNED pairing entry points
// (Requirement 9.2, 10.1): `PairingSubmission` (pairing step 3) and
// `OwnershipChallenge` (pairing step 4). See parse-command.ts's header
// comment for why every parse* function here re-checks shape even though
// a *signed* body already passed signature verification -- but neither of
// these two bodies is signed at all. At this point in the pairing
// procedure no key has been exchanged yet, so signature verification
// (task 5.3) provides ZERO protection here. Shape-checking these two
// bodies is HALF of the actual defense; the other half is the
// registration code itself (checked by the caller, not this file -- see
// design.md's pairing-procedure rationale, "#### ⑤ に条件が要る理由").
//
// This is why these 2 functions are split from task 6.2's 7 functions:
// `PairingSubmission`/`OwnershipChallenge` do NOT extend `RequestEnvelope`
// (no `relationId`, no `op`), so there is no relation identifier or op
// vocabulary to retain/validate here -- retaining `op`/`relationId` (6.2's
// rule) does not apply to either function in this file.
//
// Public-key material judgement is NOT re-derived here: `isValidKeyIdShape`
// and `isValidPublicKeyMaterial` (task 2.4, `signature/key-identity.ts` /
// `signature/key-material.ts`) already own that logic, and this file only
// calls through to it (same rule task 6.2's parse-keys.ts follows).

import type {
  ChallengeResponse,
  OwnershipChallenge,
  PairingSubmission,
} from '../contract/pairing.js';
import { parsePublicKeyRegistration } from './common-fields.js';
import { isRecord, str } from './shape.js';

/**
 * `registrationCode` is a >=128-bit random value (design.md's pairing
 * rationale) issued by proxy. Encoded as base64/hex/base64url it lands
 * somewhere around 22-256 characters depending on the encoding proxy
 * happens to use; this package does not pin the encoding, so this bound is
 * a generous defensive outer limit, not a precise shape check (unlike
 * `challenge` below, which DOES have an exact shape spec).
 */
const REGISTRATION_CODE_MAX = 256;
/** A URL an admin typed. Not validated for well-formedness here -- that is
 * `url-guard/growi-uri-guard.ts`'s (task 4.2) job on the RESOLVED address,
 * a completely different check with a completely different purpose. This
 * is only a bounded, non-empty string. */
const GROWI_URI_MAX = 4096;
/** A short human-readable label an admin typed. */
const GROWI_LABEL_MAX = 256;

/**
 * `challenge`'s exact shape (design.md's rationale table, "`challenge` の
 * 形" row): base64url, 32-128 characters inclusive. `str` (task 6.1) only
 * supports a MAX bound -- it has no minimum-length variant (tasks.md's 6.1
 * Implementation Note calls this out explicitly) -- so the >=32 half of
 * this range is checked by hand below, after `str` narrows the MAX side.
 */
const CHALLENGE_MIN = 32;
const CHALLENGE_MAX = 128;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * `challenge`'s exact shape check, extracted so `parseOwnershipChallenge`
 * (this file, pairing step 4) and `parseChallengeResponse` (task 6.4,
 * pairing step 5) apply the SAME rule instead of two hand-written copies
 * quietly drifting apart (tasks.md's 6.3->6.5 Implementation Note records
 * this exact duplication concern for `PublicKeyRegistration` and asks
 * later tasks not to repeat it -- this is the same principle applied to
 * `challenge`, which is carried by two different contract types in this
 * same file).
 */
const parseChallengeString = (v: unknown): string | undefined => {
  const challenge = str(v, CHALLENGE_MAX);
  if (
    challenge === undefined ||
    challenge.length < CHALLENGE_MIN ||
    !BASE64URL_PATTERN.test(challenge)
  ) {
    return undefined;
  }
  return challenge;
};

/**
 * Design.md's rationale table ("本体の大きさ" row) states plainly: bounding
 * `challenge`'s length alone does not bound the whole request body's size
 * -- an attacker could pad OTHER fields, or add unexpected extra keys, to
 * make the body large even with an otherwise-compliant `challenge`. Both
 * parse functions here receive an ALREADY-PARSED `unknown` value (not raw
 * wire bytes), so this check re-serializes it via `JSON.stringify` to
 * approximate the original wire size. This is a deliberate choice, not the
 * only possible one -- see CONCERNS in the task status report for the
 * two options weighed and why this one was picked.
 */
const MAX_BODY_BYTES = 8 * 1024; // 8 KiB, per design.md's explicit rationale table.

// A JSON.parse result never contains a circular reference, a BigInt, or a
// throwing toJSON, so JSON.stringify never throws on the actual input this
// package receives -- but every other parse* function in this package
// never throws either, so this stays defensive rather than relying on that
// guarantee holding for every future caller.
const exceedsMaxBodyBytes = (raw: Record<string, unknown>): boolean => {
  try {
    // `TextEncoder` (not `Buffer`) so this module stays reachable from the
    // client-safe entry point (`src/index.ts`) without pulling in a
    // Node-only global -- see design.md's "公開面を2つに分ける理由".
    return (
      new TextEncoder().encode(JSON.stringify(raw)).length > MAX_BODY_BYTES
    );
  } catch {
    return true;
  }
};

type ParseError = { readonly error: 'malformed' };

export const parsePairingSubmission = (
  raw: unknown,
): PairingSubmission | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  // Whole-body size gate runs BEFORE any per-field check, so an
  // already-oversized body is rejected without wasted work inspecting its
  // individual fields.
  if (exceedsMaxBodyBytes(raw)) {
    return { error: 'malformed' };
  }

  const registrationCode = str(raw.registrationCode, REGISTRATION_CODE_MAX);
  const growiUri = str(raw.growiUri, GROWI_URI_MAX);
  const growiLabel = str(raw.growiLabel, GROWI_LABEL_MAX);
  // Shared with parse-keys.ts's parseKeyRegistration and
  // parse-responses.ts's parsePairingResult -- see common-fields.ts's doc
  // comment on parsePublicKeyRegistration (tasks.md's 6.3->6.5 Implementation Note).
  const publicKey = parsePublicKeyRegistration(raw.publicKey);

  if (
    registrationCode === undefined ||
    growiUri === undefined ||
    growiLabel === undefined ||
    publicKey === undefined
  ) {
    return { error: 'malformed' };
  }

  return {
    registrationCode,
    growiUri,
    growiLabel,
    publicKey,
  };
};

export const parseOwnershipChallenge = (
  raw: unknown,
): OwnershipChallenge | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  if (exceedsMaxBodyBytes(raw)) {
    return { error: 'malformed' };
  }

  const registrationCode = str(raw.registrationCode, REGISTRATION_CODE_MAX);
  const challenge = parseChallengeString(raw.challenge);

  if (registrationCode === undefined || challenge === undefined) {
    return { error: 'malformed' };
  }

  return { registrationCode, challenge };
};

/**
 * `challengeSignature` is a base64url-encoded Ed25519 signature: a fixed
 * 64-byte signature encodes (no padding) to exactly 86 base64url
 * characters. 128 leaves headroom for a future signature scheme without
 * being unbounded -- design.md does not pin the exact algorithm here, so
 * this bound is chosen defensively, same convention as this file's other
 * hand-picked bounds.
 */
const CHALLENGE_SIGNATURE_MAX = 128;

/**
 * Confirms the wire shape of `ChallengeResponse` (pairing step 5, task
 * 6.4). Design.md's callout box above the parse* signatures states plainly
 * that a RESPONSE carries no signature at all, so shape-checking is the
 * ONLY acceptance gate here -- same treatment as this file's two request
 * parsers above, and the same whole-body byte-size gate applies for the
 * same reason (`exceedsMaxBodyBytes`'s doc comment above).
 */
export const parseChallengeResponse = (
  raw: unknown,
): ChallengeResponse | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  if (exceedsMaxBodyBytes(raw)) {
    return { error: 'malformed' };
  }

  const challenge = parseChallengeString(raw.challenge);
  const challengeSignature = str(
    raw.challengeSignature,
    CHALLENGE_SIGNATURE_MAX,
  );

  if (
    challenge === undefined ||
    challengeSignature === undefined ||
    !BASE64URL_PATTERN.test(challengeSignature)
  ) {
    return { error: 'malformed' };
  }

  return { challenge, challengeSignature };
};
