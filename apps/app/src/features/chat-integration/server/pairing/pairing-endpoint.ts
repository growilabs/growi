// Answers pairing step 5 -- "prove you own the URL you declared" (design.md
// `PairingEndpoint`, Requirement 9.2, 9.3).
//
// This is the ONE endpoint of the six `/peer/` entry points that carries NO
// signature (design.md's op table: "署名: 不要"). No key exists yet at this
// point in the procedure, so the only two things standing in for a
// signature are (a) matching a still-pending registration code and (b)
// signing a value that can never be reused as a production request
// signature -- see below.
//
// Three properties, all load-bearing (design.md's "#### ⑤ に条件が要る理由" /
// protocol spec's mirrored section):
//
//  - **What gets signed is `pairingChallengePayload(registrationCode,
//    challenge)`, never the bare `challenge`.** Signing the bare value would
//    turn this endpoint into an oracle: anyone who saw the registration code
//    could submit an RFC 9421 signature base as `challenge` and receive back
//    a signature usable on a forged production request, made by the SAME
//    key this GROWI later signs real requests with. The purpose prefix
//    (`growi-chat-pairing-challenge:v1:`) makes the signed string structurally
//    incapable of matching that shape.
//  - **This endpoint answers EVERY challenge while the pending registration
//    code is still alive -- it never remembers "I already answered this
//    one".** The alternative ("answer once", "only the same challenge
//    twice") sounds safer but is strictly worse: this endpoint is reachable
//    by anyone who has seen the registration code, so a third party who
//    races the real proxy's step 4 with their own `challenge` would
//    permanently burn the registration code for the legitimate pairing
//    attempt -- the real proxy's later challenge would look like a repeat
//    and be refused. Re-answering costs nothing (the purpose prefix already
//    makes every answer harmless outside this procedure), so there is
//    nothing to gain by refusing.
//  - **The rate limit counts PER SOURCE, not per pending pairing as a
//    whole.** A global-per-pairing counter would let one source's flood burn
//    through the entire budget and lock out the real proxy's own request
//    (design.md `chat_challenge_attempts`; protocol spec "上限を「保留1件あたり」
//    の通し勘定にしてはいけない").
//
// Like every other `/peer/` endpoint, the body arrives as a raw `Buffer`
// (task 2.1's `express.raw`, ahead of the app-wide `bodyParser.json`) -- this
// endpoint parses it itself, the same way `signature-guard.ts` does, even
// though there is no signature to check first.

import { createPrivateKey, sign as nodeSign } from 'node:crypto';
import type { ChallengeResponse } from '@growi/chat';
import { parseOwnershipChallenge } from '@growi/chat';
import { pairingChallengePayload } from '@growi/chat/server';
import type { RequestHandler } from 'express';

import loggerFactory from '~/utils/logger';

import { withDecryptedChatKey } from '../keys/key-encryption';
import { ChatChallengeAttempt } from './models/chat-challenge-attempt';
import { ChatPendingPairing } from './models/pending-pairing';

const logger = loggerFactory(
  'growi:features:chat-integration:pairing-endpoint',
);

/** design.md "保留 1 件・送り元アドレスごとに 1 分 30 回". */
export const CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS = 30;
export const CHALLENGE_RATE_LIMIT_WINDOW_MS = 60_000;

/** How many leading characters of a registration code are safe to put in an
 * operator-visible log line. The code is a >=128-bit secret that stays valid
 * for several minutes (Requirement 9.1), so logging it in full would let
 * anyone who can read the server log complete the pairing themselves for as
 * long as the code lives. A short, non-reversible-looking prefix is enough
 * for an operator to recognize "this is the code I just entered" without
 * reproducing a usable secret. */
const REGISTRATION_CODE_LOG_PREFIX_LENGTH = 8;

const redactedRegistrationCode = (registrationCode: string): string =>
  `${registrationCode.slice(0, REGISTRATION_CODE_LOG_PREFIX_LENGTH)}…`;

/**
 * Who is asking, and whether that identification is trustworthy.
 *
 * `req.ip` already reflects this GROWI's own `trust proxy` setting
 * (`security:trustProxyBool` / `Csv` / `Hops`, applied once for the whole
 * app in `server/crowi/express-init.js`) -- there is no reason to re-parse
 * `X-Forwarded-For` here (protocol spec "送り元アドレスの決め方": "運用者が
 * 信頼するホップ数を設定できるようにし..." is exactly what that app-wide
 * setting already does).
 *
 * `distinguishable` is `false` whenever `trust proxy` is at Express's own
 * default (`false`) -- which is also what an operator who never configured
 * any of the three `security:trustProxy*` settings sees. Behind a reverse
 * proxy that default means every request's `req.ip` is the reverse proxy's
 * own address, collapsing every real source into a single counting bucket
 * (protocol spec: "設定が無いとき ... その状態であることを運用者に見せる").
 * This function cannot tell whether a reverse proxy is actually present; it
 * reports the conservative "cannot promise separation" signal either way,
 * which is what the self-hosted deployments this protects (umbrella spec:
 * the majority case) need.
 */
export interface SourceKeyResolution {
  readonly sourceKey: string;
  readonly distinguishable: boolean;
}

/**
 * Narrower than `Pick<Request, 'ip' | 'app'>` on purpose: `Request['app']` is
 * the full Express `Application` (60+ members), which would force a test to
 * build a whole fake app just to exercise this pure function. Only
 * `app.get(...)` is actually read here, so that is all this function
 * requires -- a real `Request` still satisfies it structurally.
 */
export interface SourceKeyRequest {
  readonly ip?: string;
  readonly app: { get: (settingName: string) => unknown };
}

export const resolveSourceKey = (
  req: SourceKeyRequest,
): SourceKeyResolution => ({
  sourceKey: req.ip ?? 'unknown',
  distinguishable: req.app.get('trust proxy') !== false,
});

export interface ChallengeAttemptResult {
  readonly allowed: boolean;
  readonly count: number;
}

/**
 * Atomically counts one attempt against `(registrationCode, sourceKey)`'s
 * current 1-minute window, starting a fresh window when the stored one has
 * aged out (or none exists yet).
 *
 * Expressed as a single aggregation-pipeline update (supported by this
 * repo's MongoDB/Mongoose versions) so the "is the window still open" read
 * and the "increment or reset" write happen as one atomic document
 * operation -- a separate read-then-write here would let two concurrent
 * requests from the same source both see a stale count and both be let
 * through.
 */
export const recordChallengeAttempt = async (
  registrationCode: string,
  sourceKey: string,
  now: Date = new Date(),
): Promise<ChallengeAttemptResult> => {
  const windowStart = new Date(now.getTime() - CHALLENGE_RATE_LIMIT_WINDOW_MS);

  const row = await ChatChallengeAttempt.findOneAndUpdate(
    { registrationCode, sourceKey },
    [
      {
        $set: {
          windowStartedAt: {
            $cond: [
              { $gt: ['$windowStartedAt', windowStart] },
              '$windowStartedAt',
              now,
            ],
          },
          count: {
            $cond: [
              { $gt: ['$windowStartedAt', windowStart] },
              { $add: ['$count', 1] },
              1,
            ],
          },
        },
      },
    ],
    { upsert: true, new: true },
  ).lean();

  return {
    allowed: row.count <= CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS,
    count: row.count,
  };
};

/**
 * Signs `pairingChallengePayload(registrationCode, challenge)` with the
 * pending pairing's OWN key -- never the bare `challenge` (see file header).
 *
 * This is deliberately a raw Ed25519 signature (`node:crypto`'s `sign(null,
 * data, privateKey)`), NOT `@growi/chat`'s `sign()` / this feature's
 * `signWithOwnKey` (`../keys/key-store.ts`): both of those produce an RFC
 * 9421 signature over a request (method/headers/body/expiry/nonce), which
 * has no meaning here -- pairing step 5 signs one bare string, the same way
 * `@growi/chat`'s own reference pairing harness does
 * (`packages/chat/src/testing/pairing-harness.ts`'s `answerOwnershipChallenge`).
 * `signWithOwnKey` also reads from `chat_integration_keys`, which does not
 * hold this key yet -- it lives in `chat_pending_pairings.ownKeyPair` until
 * `PairingResult.relationId` arrives (design.md "ペアリングの途中に、自分の鍵を
 * 置く場所が要る").
 *
 * Decryption happens only inside this function, for the duration of the
 * `sign` call -- same discipline `key-store.ts`'s `signWithOwnKey` follows
 * (`../keys/key-encryption.ts`'s header comment), applied here because this
 * function is this pending pairing's equivalent of that one.
 */
const signPendingPairingChallenge = (
  encryptedOwnKeyPair: string,
  registrationCode: string,
  challenge: string,
): string =>
  withDecryptedChatKey(encryptedOwnKeyPair, (pem) => {
    const privateKey = createPrivateKey(pem);
    const payload = pairingChallengePayload(registrationCode, challenge);
    return nodeSign(null, Buffer.from(payload, 'utf8'), privateKey).toString(
      'base64url',
    );
  });

/** What a rate-limit refusal is recorded with -- an operator-visible trace of
 * the ONE symptom design.md warns is otherwise invisible: the real proxy's
 * own request answered 429 (or the source that hit the limit is not the real
 * proxy at all), and the fix is "issue a fresh registration code", which
 * nothing else in this response tells the operator. */
export interface ChallengeRateLimitContext {
  readonly sourceKey: string;
  readonly distinguishable: boolean;
  readonly count: number;
  /** Redacted -- see {@link redactedRegistrationCode}. */
  readonly registrationCode: string;
}

const logRateLimitExceeded = (
  ctx: ChallengeRateLimitContext,
): Promise<void> => {
  logger.warn(
    ctx,
    ctx.distinguishable
      ? 'Ownership-challenge rate limit exceeded for this source. If this is the legitimate proxy, issue a fresh registration code and retry.'
      : 'Ownership-challenge rate limit exceeded, but request sources cannot be distinguished (configure "trust proxy" -- security:trustProxyBool / Csv / Hops) -- this limit may be counting unrelated requests together. If this is the legitimate proxy, issue a fresh registration code and retry.',
  );
  return Promise.resolve();
};

export interface PairingEndpointDeps {
  /** Defaults to a `logger.warn` line. Injectable so a test can assert the
   * record happened without parsing log output (same pattern as
   * `signature-guard.ts`'s `recordFailure`). */
  readonly recordRateLimitExceeded?: (
    ctx: ChallengeRateLimitContext,
  ) => Promise<void>;
}

/**
 * Builds the handler for pairing step 5 (`OwnershipChallenge` ->
 * `ChallengeResponse`).
 *
 * Status codes:
 *  - `400` -- the body is not `Buffer` (wrong/missing content-type, mirroring
 *    `signature-guard.ts`'s convention), not valid JSON, or does not match
 *    `OwnershipChallenge`'s shape (including `challenge`'s base64url
 *    32-128-character rule).
 *  - `429` -- this `(registrationCode, sourceKey)` pair has already made
 *    {@link CHALLENGE_RATE_LIMIT_MAX_ATTEMPTS} attempts within the current
 *    window. Recorded via {@link PairingEndpointDeps.recordRateLimitExceeded}
 *    (a `logger.warn` line by default) -- the only symptom the real proxy
 *    sees is `ownership-unverified`, with nothing pointing at "retry with a
 *    fresh registration code" unless this record exists (protocol spec's
 *    rationale table, "記録" row).
 *  - `401` -- no pending pairing matches the submitted `registrationCode`.
 *  - `410` -- a matching pending pairing exists but has expired.
 *  - `200` -- `ChallengeResponse` with `challengeSignature` over
 *    `pairingChallengePayload(registrationCode, challenge)`.
 */
export const createPairingEndpoint = (
  deps: PairingEndpointDeps = {},
): RequestHandler => {
  const recordRateLimitExceeded =
    deps.recordRateLimitExceeded ?? logRateLimitExceeded;

  return async (req, res) => {
    // Same convention as `signature-guard.ts`: `Buffer.isBuffer`, not "is the
    // body empty" -- `express.raw` only produces a `Buffer` for
    // `application/json`; anything else slips through as the app-wide
    // parser's own (non-empty) object.
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).end();
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(req.body.toString('utf8'));
    } catch {
      res.status(400).end();
      return;
    }

    const parsed = parseOwnershipChallenge(raw);
    if ('error' in parsed) {
      res.status(400).end();
      return;
    }

    const now = new Date();
    const { sourceKey, distinguishable } = resolveSourceKey(req);

    const attempt = await recordChallengeAttempt(
      parsed.registrationCode,
      sourceKey,
      now,
    );
    if (!attempt.allowed) {
      await recordRateLimitExceeded({
        sourceKey,
        distinguishable,
        count: attempt.count,
        registrationCode: redactedRegistrationCode(parsed.registrationCode),
      });
      res.status(429).end();
      return;
    }

    const pending = await ChatPendingPairing.findOne({
      registrationCode: parsed.registrationCode,
    }).lean();
    if (pending == null) {
      res.status(401).end();
      return;
    }
    if (pending.expiresAt.getTime() <= now.getTime()) {
      res.status(410).end();
      return;
    }

    const challengeSignature = signPendingPairingChallenge(
      pending.ownKeyPair,
      parsed.registrationCode,
      parsed.challenge,
    );

    const body: ChallengeResponse = {
      challenge: parsed.challenge,
      challengeSignature,
    };
    res.status(200).json(body);
  };
};

/** The handler as wired in production (task 3.5) -- no dependency overrides. */
export const pairingEndpoint: RequestHandler = createPairingEndpoint();
