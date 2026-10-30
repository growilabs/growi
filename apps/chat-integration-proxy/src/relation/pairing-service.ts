// The proxy's half of the pairing procedure (design.md's `PairingService`,
// Requirements 8.5, 9.1-9.5; protocol design.md's steps 1-6).
//
// This module is where trust between a chat workspace and a GROWI is
// established, so the order things happen in below is the security contract,
// not a matter of taste:
//
//  - **The declared URI is judged before anything is sent to it.** The proxy
//    reaches whatever URI a submission names, so an unjudged one turns this
//    endpoint into a way to probe a closed network from outside it. Judging is
//    `GrowiUriResolver`'s job (task 5.1), called here for its verdict.
//  - **Ownership is confirmed by a SIGNATURE, not by the challenge value
//    coming back.** Value equality alone proves only that whoever answered
//    knew the registration code. A third party who saw the code could submit
//    the REAL GROWI's URI together with THEIR OWN public key; the real GROWI
//    would answer step 5 honestly, the value would match, and the relation
//    would be established under the attacker's key. Verifying the signature
//    against the key submitted at step 3 is what closes that
//    (protocol design.md: 「⑤ が公開鍵を縛る理由」).
//  - **The answer's shape is checked before it is verified.** Step 5's answer
//    is the one thing this proxy accepts from a party it holds no key for, so
//    `parseChallengeResponse` is the only acceptance gate there is.
//  - **The order is consumed by a conditional write.** `pairing/submit` carries
//    neither a signature nor a nonce and is the most resendable entry point in
//    the protocol, so only the writer that flips `consumed_at` proceeds; every
//    other copy answers with the winner's result.
//
// **This module must not reach `growi/`** (design.md's dependency order), so
// the function that actually delivers the challenge arrives as a parameter.
// `orchestration/` composes it out of `GrowiUriResolver` and hands it in.
//
// What the administrator is told is deliberately thin: only the KIND of
// failure, never the peer's own words or the proxy's view of the network
// (design.md 「管理者に返すのは失敗の種類だけで、相手の応答の中身は返さない」).

import {
  createHash,
  createPublicKey,
  verify as nodeVerify,
  randomBytes,
} from 'node:crypto';
import {
  type ChallengeResponse,
  type ChatAccountRef,
  type OwnershipChallenge,
  type PairingResult,
  type PairingSubmission,
  type PlatformName,
  type PublicKeyRegistration,
  parseChallengeResponse,
} from '@growi/chat';
import {
  isValidKeyIdShape,
  isValidPublicKeyMaterial,
  pairingChallengePayload,
} from '@growi/chat/server';

import {
  createInstallationRepository,
  createPairingOrderRepository,
  createPeerKeyRepository,
  createRelationRepository,
  type DbClient,
  type PrismaClient,
  RelationAlreadyExistsError,
} from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import type { GrowiUriResolver } from './growi-uri-resolver.js';
import { createRelationKeyService } from './relation-key-service.js';
import { createUnpairService } from './unpair-service.js';

/**
 * Delivers the ownership challenge to the declared URI and answers what came
 * back. **A `GrowiClient` is deliberately NOT imported here**: `relation/` sits
 * to the LEFT of `growi/` in the dependency order, so the caller composes this
 * function and passes it in.
 *
 * The declared return type is an already-parsed `ChallengeResponse`, so the
 * implementation is expected to run `parseChallengeResponse` on the raw body it
 * received. `submit` runs it again on whatever it is handed -- the function is
 * idempotent on a valid response, and re-running it means a defective
 * implementation cannot feed unchecked input into the verification below.
 */
export type SendChallenge = (
  growiUri: string,
  challenge: OwnershipChallenge,
) => Promise<ChallengeResponse>;

export interface PairingService {
  /**
   * Hands out a registration code for an administrator to paste into GROWI.
   * Only its hash is stored (Requirement 10.6).
   *
   * @throws {PairingOrderLimitError} when the installation already has
   * {@link MAX_LIVE_PAIRING_ORDERS} live codes.
   */
  issueCode(
    installationId: string,
    issuedBy: ChatAccountRef,
  ): Promise<{ readonly code: string; readonly expiresAt: Date }>;
  /** Steps 3-6 of the pairing procedure. */
  submit(
    submission: PairingSubmission,
    send: SendChallenge,
  ): Promise<PairingResult>;
  /**
   * Disconnects one GROWI from its chat workspace (Requirement 9.7).
   *
   * Delegated to {@link createUnpairService}, which owns the ordered deletion
   * and documents what it does and does not remove. It is reachable from here
   * because design.md declares it on this interface: pairing and its undoing
   * are one surface for `orchestration/` to hold.
   */
  unpair(relationId: string): Promise<void>;
}

/**
 * How long a registration code stays usable. design.md asks for 「一定時間で
 * 失効する」 without naming a figure; 15 minutes is long enough for an
 * administrator to move from the chat client to GROWI's admin screen and short
 * enough that a code read over someone's shoulder is not usable later in the
 * day. Same convention as `PENDING_COLLECTION_TTL_MS` (task 4.4).
 */
export const REGISTRATION_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * How many wrong submissions one code tolerates before it stops answering.
 * The code carries 192 bits of randomness, so this is not what makes guessing
 * infeasible -- it bounds how much work a single stolen-and-mistyped code can
 * cause, which is what protocol design.md's 「間違えた試行の回数に上限を置く」
 * asks for.
 */
export const MAX_SUBMISSION_ATTEMPTS = 5;

/**
 * How many of an installation's codes may be live at once
 * (protocol design.md: 「installation ごとに、発行数と…上限を置く」). Every live
 * code is another open window, and an administrator pairing several GROWIs at
 * once needs only a few; the cap is lifted by codes expiring, so nothing has to
 * be cleaned up by hand.
 */
export const MAX_LIVE_PAIRING_ORDERS = 5;

/** How many random bytes a registration code carries (>= 128 bits). */
const REGISTRATION_CODE_BYTES = 24;
/** base64url of 32 bytes is 43 characters -- inside the contract's 32..128. */
const CHALLENGE_BYTES = 32;

/** Raised by `issueCode` when the installation is at {@link MAX_LIVE_PAIRING_ORDERS}. */
export class PairingOrderLimitError extends Error {
  constructor(readonly installationId: string) {
    super(
      `Installation ${installationId} already has ${MAX_LIVE_PAIRING_ORDERS} live registration codes. Use one of them, or wait for them to expire.`,
    );
    this.name = 'PairingOrderLimitError';
  }
}

export interface PairingServiceDeps {
  /**
   * The client rather than a `DbClient`: this service OPENS the transaction the
   * `relation` row and the `own_key` row share, which a transaction handle
   * cannot do.
   */
  readonly db: PrismaClient;
  readonly cipher: SecretCipher;
  /** Judges a declared URI before the challenge is sent to it (task 5.1). */
  readonly uriResolver: GrowiUriResolver;
  readonly now?: () => Date;
  /** Injectable so a test can pin the value; never weakened in production. */
  readonly generateRegistrationCode?: () => string;
  readonly generateChallenge?: () => string;
}

/**
 * How a registration code is stored. SHA-256 rather than a password hash, and
 * the reason is structural rather than a judgement about cost: the code is
 * looked up by `code_hash`'s unique index, which only a deterministic, unsalted
 * hash allows. A per-row salt (bcrypt, scrypt, argon2) would make the lookup
 * impossible without reading every row. That is acceptable here precisely
 * because the code is not a password -- it is 192 bits of randomness this proxy
 * generated, so there is no dictionary to run against a leaked hash.
 */
const hashRegistrationCode = (code: string): string =>
  createHash('sha256').update(code, 'utf8').digest('hex');

/**
 * What the administrator is told when ownership could not be confirmed. Every
 * cause collapses into one of these: the peer's own words and the proxy's view
 * of the network never travel outward, or `submit` becomes a way to read the
 * network from where the proxy stands.
 */
const UNVERIFIED_DETAIL = {
  uriRefused:
    'The declared GROWI URL was refused. It must be an https URL on the default port, reachable from this proxy, and not a private address unless the operator allow-listed it.',
  keyRejected:
    'The submitted public key is not an Ed25519 public key in the expected form.',
  noAnswer:
    'The declared GROWI URL did not return a usable answer to the ownership challenge.',
  notProven:
    'The answer to the ownership challenge did not prove that the declared GROWI holds the submitted key.',
} as const;

const unverified = (detail: string): PairingResult => ({
  status: 'ownership-unverified',
  detail,
});

/**
 * Every rejection of the code itself -- unknown, expired, or guessed at too
 * often -- answers the same way.
 *
 * Only four statuses exist, and this is the one whose remedy (Requirement 9.4:
 * 「やり直しの手順を管理者に示す」) is the right one for all three. Keeping them
 * apart would also hand a submitter an oracle separating "wrong code" from "no
 * such code", and `ownership-unverified` would send the administrator looking
 * at reachability instead of at the code.
 */
const CODE_EXPIRED: PairingResult = { status: 'code-expired' };

/** Confirms the answer was signed by the key submitted at step 3. */
const challengeSignatureIsValid = (params: {
  readonly submission: PairingSubmission;
  readonly registrationCode: string;
  readonly challenge: string;
  readonly signature: string;
}): boolean => {
  const { submission, registrationCode, challenge, signature } = params;
  try {
    return nodeVerify(
      // Ed25519 signs the message itself -- no digest algorithm is named, which
      // is what `null` here means.
      null,
      Buffer.from(
        // NOT the bare challenge: the purpose prefix is what keeps step 5 from
        // being a window that signs any string a caller chooses
        // (protocol design.md 「⑤ で署名する値」).
        pairingChallengePayload(registrationCode, challenge),
        'utf8',
      ),
      createPublicKey({
        // Spread into a fresh object: the contract's `JsonWebKey` and the one
        // `node:crypto` accepts are separate declarations of the same shape.
        key: { ...submission.publicKey.publicKeyJwk },
        format: 'jwk',
      }),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    // Unreadable key material or an unusable signature encoding. Both are the
    // submitter's doing and mean the same thing here: not proven.
    return false;
  }
};

export const createPairingService = (
  deps: PairingServiceDeps,
): PairingService => {
  const { db, cipher, uriResolver } = deps;
  const now = deps.now ?? (() => new Date());
  const generateRegistrationCode =
    deps.generateRegistrationCode ??
    // base64url: high entropy, typable, and -- the part that matters --
    // never contains `:`, which `pairingChallengePayload` relies on as its
    // separator.
    (() => randomBytes(REGISTRATION_CODE_BYTES).toString('base64url'));
  const generateChallenge =
    deps.generateChallenge ??
    (() => randomBytes(CHALLENGE_BYTES).toString('base64url'));

  const orders = createPairingOrderRepository(db);
  const relations = createRelationRepository(db);
  const installations = createInstallationRepository(db, cipher);
  const keys = createRelationKeyService({ db, cipher, now });
  const unpairing = createUnpairService({ db, cipher });

  /** The workspace a relation belongs to, as `PairingResult` carries it. */
  const workspaceOf = async (installationId: string) => {
    const installation = await installations.findById(installationId);
    if (installation == null) {
      throw new Error(
        `Installation ${installationId} vanished while pairing with it.`,
      );
    }
    return {
      // `platform` is stored as a plain string so that adding a chat service
      // needs no migration; the column is only ever written from
      // `PlatformName` (`InstallationRepository.save`), so narrowing it back
      // here is reading the column as what was written -- same treatment as
      // `platform/event-mapping.ts`.
      platform: installation.platform as PlatformName,
      workspaceId: installation.workspaceId,
      workspaceName: installation.workspaceName,
    };
  };

  /**
   * The result a code that ALREADY paired answers with -- the same one its
   * first submission got, rebuilt rather than remembered.
   *
   * `null` when there is nothing to rebuild -- the code is spent and the
   * administrator has to ask for a new one. Two ways that happens:
   *
   *  - the relation was unpaired since (`pairing_order.relation_id` is cleared
   *    by `SetNull`);
   *  - **this submission is not the one that paired.** One code pairs ONE
   *    GROWI, so a submission naming a different URI is a different pairing
   *    attempt that happens to carry the same code -- usually one code pasted
   *    into two GROWIs by mistake. Answering it with `paired` would leave the
   *    second GROWI holding a `relationId` this proxy has no relation for, so
   *    every signed request it later makes would fail verification with
   *    nothing anywhere explaining why. It would also hand that `relationId`
   *    (deliberately unguessable -- it travels as `keyid`) and the workspace's
   *    name to whoever submitted.
   */
  const resultForConsumedCode = async (
    codeHash: string,
    growiUri: string,
  ): Promise<PairingResult | null> => {
    const order = await orders.findByCodeHash(codeHash);
    if (order?.consumedAt == null || order.relationId == null) {
      return null;
    }
    const relation = await relations.findById(order.relationId);
    if (relation == null || relation.growiUri !== growiUri) {
      return null;
    }
    return {
      status: 'paired',
      relationId: relation.relationId,
      workspace: await workspaceOf(relation.installationId),
      publicKey: await keys.publicKeyFor(relation.relationId),
    };
  };

  return {
    issueCode: async (installationId, _issuedBy) => {
      // `issuedBy` is part of design.md's declared signature and is kept so
      // `orchestration/` can call against it, but nothing is stored: there is
      // no column for it (design.md's `pairing_order`) and this app has no
      // logger. A task that adds an audit trail is where it starts being used.
      const issuedAt = now();
      const live = await orders.countLive(
        installationId,
        issuedAt,
        MAX_SUBMISSION_ATTEMPTS,
      );
      if (live >= MAX_LIVE_PAIRING_ORDERS) {
        throw new PairingOrderLimitError(installationId);
      }

      const code = generateRegistrationCode();
      const expiresAt = new Date(issuedAt.getTime() + REGISTRATION_CODE_TTL_MS);
      await orders.issue(installationId, hashRegistrationCode(code), expiresAt);
      return { code, expiresAt };
    },

    submit: async (submission, send) => {
      const codeHash = hashRegistrationCode(submission.registrationCode);
      const order = await orders.findByCodeHash(codeHash);
      if (order == null) {
        return CODE_EXPIRED;
      }

      // Before anything is counted: a resubmission of a code that ALREADY
      // paired is not a wrong guess, and must answer with the same result
      // rather than mint a second relation.
      if (order.consumedAt != null) {
        return (
          (await resultForConsumedCode(codeHash, submission.growiUri)) ??
          CODE_EXPIRED
        );
      }

      // Counted by the database, not read-then-written here: two submissions
      // arriving together must not both spend the same attempt. Counting
      // BEFORE the URI is resolved is what makes this cap bound the outbound
      // traffic one code can cause, not just the guesses it allows.
      const attempts = await orders.recordAttempt(order.id);
      if (attempts > MAX_SUBMISSION_ATTEMPTS) {
        return CODE_EXPIRED;
      }
      if (order.expiresAt <= now()) {
        return CODE_EXPIRED;
      }

      // The registering side's duty, stated by `PublicKeyRegistration`'s own
      // contract: `JsonWebKey` also describes RSA, elliptic-curve and secret
      // keys, and a key carrying `d` would be a private key on the wire.
      if (
        !isValidPublicKeyMaterial({ ...submission.publicKey.publicKeyJwk })
          .ok ||
        !isValidKeyIdShape(submission.publicKey.keyId)
      ) {
        return unverified(UNVERIFIED_DETAIL.keyRejected);
      }

      // Requirement 8.5, asked before any traffic leaves: a submission that
      // cannot be granted should not cause the proxy to reach out at all. The
      // unique constraint below still settles two submissions that both looked
      // and both found nothing.
      const existing = await relations.findByGrowiUri(
        order.installationId,
        submission.growiUri,
      );
      if (existing != null) {
        return {
          status: 'already-paired',
          detail: `This GROWI is already paired with this workspace as "${existing.growiLabel}".`,
        };
      }

      // The URI is judged here, not inside `send`: `SendChallenge` answers with
      // a `ChallengeResponse` and so has no way to report a refused URI. The
      // resolved addresses are cached for a few seconds (task 5.1), so the
      // connection `send` makes right after does not resolve the name twice in
      // any meaningful sense -- and re-judging per request is 5.1's own rule.
      const judged = await uriResolver.connect(submission.growiUri);
      if (!judged.ok) {
        return unverified(UNVERIFIED_DETAIL.uriRefused);
      }

      const challenge = generateChallenge();
      let answer: ChallengeResponse;
      try {
        answer = await send(submission.growiUri, {
          registrationCode: submission.registrationCode,
          challenge,
        });
      } catch {
        // The peer's own error text is deliberately dropped: it describes what
        // the proxy can see from where it stands.
        return unverified(UNVERIFIED_DETAIL.noAnswer);
      }

      // The shape check is the only acceptance gate this answer gets -- it is
      // the one message accepted from a party no key is held for.
      const parsed = parseChallengeResponse(answer);
      if ('error' in parsed) {
        return unverified(UNVERIFIED_DETAIL.noAnswer);
      }

      if (
        parsed.challenge !== challenge ||
        !challengeSignatureIsValid({
          submission,
          registrationCode: submission.registrationCode,
          challenge,
          signature: parsed.challengeSignature,
        })
      ) {
        return unverified(UNVERIFIED_DETAIL.notProven);
      }

      const pairedAt = now();
      let paired: {
        readonly relationId: string;
        readonly publicKey: PublicKeyRegistration;
      };
      try {
        paired = await db.$transaction(async (tx: DbClient) => {
          const relation = await createRelationRepository(tx).create({
            installationId: order.installationId,
            growiUri: submission.growiUri,
            growiLabel: submission.growiLabel,
            // Equal weights make `SearchFusion` interleave results, which is
            // the neutral starting point; the `weight` admin command (3.8) is
            // how an operator moves it.
            searchWeight: 1,
            // No settings have been pushed yet, so the first push (version 1)
            // is newer than what is held here and applies.
            settingsVersion: 0,
          });
          // Built over `tx`, so the proxy's own private key is committed with
          // the relation or with neither (design.md 「関係の行と鍵の行を同じ
          // トランザクションで書ける」).
          // The minted key is used as it comes back rather than read again:
          // this is the key that was just written, and re-reading it inside the
          // same transaction would only add a way for the two to disagree.
          //
          // Written BEFORE the peer key on purpose. The private key is the one
          // row here that must never outlive a failed pairing, so every write
          // that can still fail belongs AFTER it -- that is the window
          // `pairing-transaction.integ.ts` breaks to show the rollback really
          // removes it, and a test that never reached this line would only be
          // showing that a key nobody wrote is absent.
          const ownKey = await createRelationKeyService({
            db: tx,
            cipher,
            now: () => pairedAt,
          }).issue(relation.relationId);

          await createPeerKeyRepository(tx).register(
            relation.relationId,
            submission.publicKey,
          );

          const won = await createPairingOrderRepository(
            tx,
          ).consumeIfUnconsumed(order.id, relation.relationId, pairedAt);
          if (!won) {
            // Another copy of this submission got there first. Undo everything
            // written here and answer with the winner's result instead.
            throw new RelationAlreadyExistsError(
              order.installationId,
              submission.growiUri,
            );
          }
          return {
            relationId: relation.relationId,
            publicKey: {
              keyId: ownKey.keyId,
              publicKeyJwk: ownKey.publicKeyJwk,
              validFrom: pairedAt.toISOString(),
            },
          };
        });
      } catch (error) {
        if (error instanceof RelationAlreadyExistsError) {
          // Either the unique constraint or the conditional consume rejected
          // this copy. Whichever it was, the winner's result -- if there is one
          // -- is what this submission must answer with.
          return (
            (await resultForConsumedCode(codeHash, submission.growiUri)) ?? {
              status: 'already-paired',
              detail: 'This GROWI is already paired with this workspace.',
            }
          );
        }
        throw error;
      }

      return {
        status: 'paired',
        relationId: paired.relationId,
        workspace: await workspaceOf(order.installationId),
        publicKey: paired.publicKey,
      };
    },

    unpair: (relationId) => unpairing.unpair(relationId),
  };
};
