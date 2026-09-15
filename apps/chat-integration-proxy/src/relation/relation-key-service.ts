// This proxy's own signing keys, one set per relation (design.md's
// `RelationKeyService`, Requirements 9.5 / 9.6).
//
// Two properties are the reason this sits in `relation/` rather than in the
// storage layer:
//
//  - **A key belongs to one relation and to no other.** The keypair is minted
//    per relation, so one GROWI's private key leaking cannot be used against
//    any other GROWI the same workspace is paired with.
//  - **The key is written through the `DbClient` the caller supplied**, never
//    through a client this module reaches for itself. That is what lets
//    `PairingService` construct this service over the `tx` of its own
//    `$transaction`, alongside a `RelationRepository` over the same handle, and
//    get the `relation` row and its `own_key` row committed or rolled back
//    together (design.md: 「関係の行と鍵の行を同じトランザクションで書ける」).
//    The proxy mints `relationId` itself, so there is no ordering problem to
//    work around.
//
// **What leaves this layer is the means to sign, not key material.** The
// decrypted PEM exists only inside `own-key-repository`; `signerFor` returns
// the `KeyObject` that `sign()` takes, which callers hand on without ever
// unwrapping (Requirement 9.6).

import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomUUID,
} from 'node:crypto';
import type {
  KeyOperationResult,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  PublicKeyRegistration,
} from '@growi/chat';
import { OP_NAMES } from '@growi/chat';
import { type KeyRef, SIGNATURE_ALGORITHM } from '@growi/chat/server';

import {
  createOwnKeyRepository,
  createRelationRepository,
  type DbClient,
  type OwnKeyRecord,
} from '../db/index.js';
import type { SecretCipher } from '../types/index.js';

export interface RelationKeyService {
  /**
   * Mints this proxy's key for one relation and stores it. Called at pairing
   * time, from inside the transaction that writes the `relation` row.
   */
  issue(
    relationId: string,
  ): Promise<{ readonly keyId: string; readonly publicKeyJwk: JsonWebKey }>;
  /**
   * The relation's current signing key. Returns the means to sign; the
   * decrypted private key never exists outside `own-key-repository`.
   */
  signerFor(
    relationId: string,
  ): Promise<{ readonly key: KeyRef; readonly privateKey: KeyObject }>;
  /**
   * The relation's current key, in the shape the peer registers it in.
   *
   * Needed because `own_key` stores the private key alone: the public half is
   * derived, never a column. `PairingService` uses this to answer a REPEATED
   * pairing submission with the same `PairingResult` the first one got --
   * that result carries this proxy's public key, and re-minting a key to
   * answer would hand the peer a key it is not holding.
   */
  publicKeyFor(relationId: string): Promise<PublicKeyRegistration>;
  /**
   * Steps 1-3 of a rotation, for every relation of one installation: mint the
   * new key, offer it to the GROWI, and report what did not get through. The
   * old key stays valid throughout -- nothing stops signing here.
   *
   * **Called again, it does not mint again.** A relation whose new key already
   * reached its GROWI is left alone; a relation whose new key did not is sent
   * the SAME key once more. Minting per attempt would pile up keys behind an
   * old one that never gets revoked, every time an operator fixes a GROWI and
   * runs the command again.
   *
   * Never throws for one relation's sake: a target that cannot be reached is
   * one {@link RotationResult} among the others.
   */
  rotate(
    installationId: string,
    send: SendKeyRegistration,
  ): Promise<ReadonlyArray<RotationResult>>;
  /**
   * What a rotation of this installation has and has not reached, relation by
   * relation -- what `rotate-key status` shows an operator before step 4 runs
   * (design.md: 「入れ替えの途中経過（関係ごとの未達）を見る」).
   *
   * Read-only: nothing is minted, marked or revoked by looking. It lives here
   * rather than being assembled from `own_key` rows at the call site because
   * "which key is in charge, and which one is coming in" is {@link standingOf}'s
   * rule, and a second reading of those rows elsewhere is a second place for
   * that rule to live.
   */
  rotationStatus(
    installationId: string,
  ): Promise<ReadonlyArray<RotationStatus>>;
  /**
   * Step 4, deliberately a separate operation. Folding it into `rotate` as a
   * condition would put 「未達があるうちは失効させない」 one forgotten branch
   * away from breaking; kept apart, not calling it is all the protection
   * needed.
   *
   * Answers whether every old key of this installation's in-progress rotations
   * is now revoked, so `false` covers three situations: nobody may be revoked
   * yet, some were and some could not be, and there was no rotation under way
   * at all (a finished rotation answers `false` on every later call, having
   * nothing left to revoke). Calling it again resumes what is left: a relation
   * whose old key is already revoked no longer counts as having a rotation
   * under way.
   */
  revokeOldIfAllDelivered(
    installationId: string,
    send: SendKeyRevocation,
  ): Promise<boolean>;
}

/**
 * What came back from one attempt to hand a key operation to a GROWI.
 *
 * **A network call reaches this module as a value, never as an exception**, so
 * one unreachable GROWI cannot end a rotation the other GROWIs are half-way
 * through -- the same reason `PairingService` reports its own send failures as
 * a `PairingResult` rather than letting them escape.
 *
 * The field is named `response` (not `result`) on purpose: that makes
 * `GrowiClient.registerKey` / `.revokeKey` structurally assignable to the two
 * function types below, so `orchestration/` can hand them in as they are
 * instead of maintaining an adapter that could drift.
 */
export type KeyDeliveryOutcome =
  | { readonly ok: true; readonly response: KeyOperationResult }
  /** Why the answer never arrived. Free-form: `growi/` owns that vocabulary. */
  | { readonly ok: false; readonly reason: string };

/**
 * Hands a `key-register-to-growi` request to one GROWI and answers what came
 * back. **A `GrowiClient` is deliberately NOT imported here**: `relation/` sits
 * to the LEFT of `growi/` in the dependency order, so the caller composes this
 * function and passes it in -- exactly as `PairingService` takes
 * {@link SendChallenge}. `orchestration/` builds it out of `GrowiClient`.
 *
 * The implementation signs the request, and reaches the signing key through
 * {@link RelationKeyService.signerFor} -- which is what makes 「署名は古い鍵で
 * 行う」 hold without `rotate` having to know anything about signing.
 */
export type SendKeyRegistration = (
  growiUri: string,
  request: KeyRegistrationRequest,
) => Promise<KeyDeliveryOutcome>;

/** The revocation half of {@link SendKeyRegistration}. */
export type SendKeyRevocation = (
  growiUri: string,
  request: KeyRevocationRequest,
) => Promise<KeyDeliveryOutcome>;

export interface RotationResult {
  readonly relationId: string;
  /**
   * The key this relation is moving to -- different per relation, because keys
   * are per relation. `null` when no key could be minted at all, which
   * design.md's declaration does not cover: it writes `string`, on the
   * assumption that every relation has a key to rotate away from. A relation
   * whose only key was revoked without the relation being unpaired breaks that
   * assumption, and the operator has to be TOLD about it -- minting there would
   * produce a key signed by itself, which no GROWI holds, and dropping the
   * relation from the list would hide it.
   */
  readonly newKeyId: string | null;
  readonly delivery:
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string };
}

/**
 * One relation's place in an in-progress rotation.
 *
 * A relation with nothing under way is reported with `newKeyId: null` rather
 * than left out: an operator reading the list has to be able to tell "this
 * GROWI is holding the rotation up" from "this GROWI is not in the list I
 * expected".
 */
export interface RotationStatus {
  readonly relationId: string;
  /** Carried so the answer can name the GROWI without a second read. */
  readonly growiLabel: string;
  /** The key being moved to, or `null` when no rotation is under way. */
  readonly newKeyId: string | null;
  readonly deliveredToPeer: boolean;
  /**
   * Why this relation's keys could not be read as a rotation at all -- the
   * three states {@link standingOf} refuses to guess about. `null` when the
   * keys were readable, whether or not a rotation is under way.
   */
  readonly problem:
    | 'no-valid-key'
    | 'ambiguous-keys'
    | 'no-key-in-charge'
    | null;
}

export interface RelationKeyServiceDeps {
  /**
   * Either the client or a transaction handle -- see the file header. Passing
   * a `tx` is how a caller makes the key share the pairing's unit of work.
   */
  readonly db: DbClient;
  readonly cipher: SecretCipher;
  /**
   * Defaults to a UUID. Injectable so a test can pin the value; the peer
   * checks the shape at registration (`isValidKeyIdShape`), which a UUID meets.
   */
  readonly generateKeyId?: () => string;
  readonly now?: () => Date;
}

/**
 * Which of a relation's keys is the one that signs, and whether a rotation is
 * under way. **This is the whole of the "which key signs" policy**, in one pure
 * function, so `signerFor`, `rotate` and `revokeOldIfAllDelivered` cannot come
 * to different answers about the same rows.
 *
 * The rule reads no clock, only the two rotation columns:
 *
 *  - a revoked key never signs;
 *  - a key that **supersedes a key which is itself still valid** has not taken
 *    over yet. That is the state step 1 of a rotation creates on purpose
 *    (design.md: 「この時点で古い鍵も有効なまま」), and the OLD key keeps
 *    signing until every GROWI has accepted the new one (「署名は古い鍵で行う
 *    — 新しい鍵はまだ相手が知らない」). Once step 4 revokes the old key, the
 *    new one is the only candidate left and takes over with nothing else to
 *    change.
 *
 * Anything the rule cannot decide is reported rather than guessed: refusing to
 * sign is better than signing with a key the peer may never have accepted.
 * (Task 5.2 left a placeholder here that refused ANY two valid keys, with a
 * note that this task must replace it -- this is that replacement.)
 */
type KeyStanding =
  | {
      readonly kind: 'ok';
      readonly signing: OwnKeyRecord;
      /** The new key of an unfinished rotation, or `null` when none is under way. */
      readonly incoming: OwnKeyRecord | null;
    }
  /** Every key is revoked, or the relation has none. */
  | { readonly kind: 'no-valid-key' }
  /** Several valid keys, none of which replaces another. */
  | { readonly kind: 'ambiguous-keys'; readonly keyIds: ReadonlyArray<string> }
  /** Every valid key is superseded by another valid one -- a cycle nothing writes. */
  | { readonly kind: 'no-key-in-charge' };

const standingOf = (keys: ReadonlyArray<OwnKeyRecord>): KeyStanding => {
  // Only `revokedAt` is read. `validFrom` is deliberately not compared against
  // the clock: nothing writes a future-dated key, and adding the comparison
  // would put a second, untested rule in front of signing.
  const valid = keys.filter((key) => key.revokedAt == null);
  if (valid.length === 0) {
    return { kind: 'no-valid-key' };
  }

  const validIds = new Set(valid.map((key) => key.keyId));
  const inCharge = valid.filter(
    (key) => key.supersededKeyId == null || !validIds.has(key.supersededKeyId),
  );
  if (inCharge.length === 0) {
    return { kind: 'no-key-in-charge' };
  }
  if (inCharge.length > 1) {
    return { kind: 'ambiguous-keys', keyIds: inCharge.map((key) => key.keyId) };
  }

  const signing = inCharge[0];
  return {
    kind: 'ok',
    signing,
    incoming:
      valid.find((key) => key.supersededKeyId === signing.keyId) ?? null,
  };
};

/**
 * The rejection a REVOCATION may go ahead over: the peer says it does not know
 * the key, so there is nothing left to tell it and the local revoke is what
 * remains. Every other rejection stops the revoke -- see the call site.
 *
 * **This is defensive, not a path this proxy can produce on its own.** The
 * revocation is signed with the key being revoked (the old key is still the one
 * `signerFor` hands out at that moment), so a peer that already dropped it
 * cannot verify the request at all and answers with a transport error rather
 * than this rejection. It is kept for a peer whose bookkeeping differs from
 * ours -- one that accepted the revocation, kept honouring the signature, and
 * reports the key as unknown on a second telling.
 *
 * The same ordering leaves one known gap: if the peer accepts the revocation
 * and this proxy stops before writing `revoked_at`, every later attempt is
 * signed with a key the peer has dropped, and that old key stays valid on this
 * side. Closing it means signing the revocation with the NEW key, which
 * `signerFor` does not hand out while the old one is valid -- a change to the
 * rule above and to `GrowiClient`, neither of which belongs in this task.
 */
const REVOCATION_ALREADY_DONE: ReadonlyArray<string> = ['unknown-key'];

/**
 * Runs one send and reduces everything it can answer to "the peer applied it"
 * or "it did not happen, and here is the kind of failure".
 *
 * **A thrown error becomes a value.** A `SendKeyRegistration` is composed
 * outside this layer, so it may throw whatever its implementation throws; one
 * target's exception must never end a rotation the other targets are half-way
 * through.
 *
 * **A rejection is not a delivery.** It arrives on a 2xx answer, so it is not a
 * transport failure -- but the peer did not take the key, and treating it as
 * delivered would let step 4 revoke an old key the GROWI still depends on.
 */
const deliver = async (
  attempt: () => Promise<KeyDeliveryOutcome>,
  tolerated: ReadonlyArray<string> = [],
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly reason: string }
> => {
  let outcome: KeyDeliveryOutcome;
  try {
    outcome = await attempt();
  } catch {
    // The peer's own error text is deliberately dropped: it describes what this
    // proxy can see from where it stands (design.md 「管理者に返すのは失敗の
    // 種類だけ」), same treatment as `PairingService.submit`.
    return { ok: false, reason: 'send-failed' };
  }
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }
  if (outcome.response.status === 'ok') {
    return { ok: true };
  }
  return tolerated.includes(outcome.response.reason)
    ? { ok: true }
    : { ok: false, reason: `rejected:${outcome.response.reason}` };
};

export const createRelationKeyService = (
  deps: RelationKeyServiceDeps,
): RelationKeyService => {
  const ownKeys = createOwnKeyRepository(deps.db, deps.cipher);
  const generateKeyId = deps.generateKeyId ?? (() => randomUUID());
  const now = deps.now ?? (() => new Date());

  const relations = createRelationRepository(deps.db);

  const standingFor = async (relationId: string): Promise<KeyStanding> =>
    standingOf(await ownKeys.listKeys(relationId));

  const loadSignerOrThrow = async (
    relationId: string,
    keyId: string,
  ): Promise<{ readonly key: KeyRef; readonly privateKey: KeyObject }> => {
    const signer = await ownKeys.loadSigner({ relationId, keyId });
    if (signer == null) {
      // Distinct from "no valid key": the listing saw this row, so it was
      // deleted in between rather than never having existed.
      throw new Error(
        `Signing key ${keyId} of relation ${relationId} vanished between listing and load.`,
      );
    }
    return signer;
  };

  /**
   * The relation's one key that signs, with both the row (for `validFrom`) and
   * the means to sign. Shared by `signerFor` and `publicKeyFor` so the two can
   * never disagree about WHICH key is current.
   */
  const currentKey = async (
    relationId: string,
  ): Promise<{
    readonly record: OwnKeyRecord;
    readonly signer: { readonly key: KeyRef; readonly privateKey: KeyObject };
  }> => {
    const standing = await standingFor(relationId);

    if (standing.kind === 'no-valid-key') {
      throw new Error(
        `No valid signing key for relation ${relationId}. A relation is paired with a key or not at all, so this means the key was revoked or deleted without the relation being removed.`,
      );
    }
    if (standing.kind === 'ambiguous-keys') {
      throw new Error(
        `Relation ${relationId} has more than one valid signing key (${standing.keyIds.join(', ')}) and none of them replaces another. Only a rotation puts two valid keys on one relation, and a rotation's new key names the key it replaces.`,
      );
    }
    if (standing.kind === 'no-key-in-charge') {
      throw new Error(
        `Every valid key of relation ${relationId} is superseded by another valid one, so none of them is the one that signs. Nothing here writes that state, so these rows were altered.`,
      );
    }

    return {
      record: standing.signing,
      signer: await loadSignerOrThrow(relationId, standing.signing.keyId),
    };
  };

  /** The public half of one stored key, in the shape the peer registers it in. */
  const registrationFor = async (
    relationId: string,
    key: OwnKeyRecord,
  ): Promise<PublicKeyRegistration> => {
    const signer = await loadSignerOrThrow(relationId, key.keyId);
    return {
      keyId: key.keyId,
      // Derived from the private key rather than stored: `own_key` has no
      // public column, and deriving cannot drift from what actually signs.
      publicKeyJwk: createPublicKey(signer.privateKey).export({
        format: 'jwk',
      }),
      validFrom: key.validFrom.toISOString(),
    };
  };

  /**
   * Step 1 for one relation: a new key, valid immediately, naming the key it
   * replaces. The old key is left untouched -- it is still the one that signs.
   */
  const mintSuccessor = async (
    relationId: string,
    supersededKeyId: string,
  ): Promise<PublicKeyRegistration> => {
    const { publicKey, privateKey } = generateKeyPairSync(SIGNATURE_ALGORITHM);
    const keyId = generateKeyId();
    const validFrom = now();

    await ownKeys.issue(relationId, {
      keyId,
      privateKeyPem: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
      validFrom,
      supersededKeyId,
    });

    return {
      keyId,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      validFrom: validFrom.toISOString(),
    };
  };

  /**
   * Steps 1-3 for ONE relation. Nothing here throws: every way this can fail
   * becomes that relation's own `delivery`, so the relations after it still get
   * their turn.
   */
  const rotateOne = async (
    relation: { readonly relationId: string; readonly growiUri: string },
    send: SendKeyRegistration,
  ): Promise<RotationResult> => {
    const { relationId, growiUri } = relation;
    const standing = await standingFor(relationId);
    if (standing.kind !== 'ok') {
      // No key to rotate away from, or no telling which one that is. Minting
      // here would produce a key whose own registration could only be signed by
      // itself -- and no GROWI holds it.
      return {
        relationId,
        newKeyId: null,
        delivery: { ok: false, reason: standing.kind },
      };
    }

    // Already through: neither re-minted nor re-sent (「2 回目以降は作り直さず、
    // 届いていない相手にだけ配り直す」).
    if (standing.incoming?.deliveredToPeerAt != null) {
      return {
        relationId,
        newKeyId: standing.incoming.keyId,
        delivery: { ok: true },
      };
    }

    let key: PublicKeyRegistration;
    try {
      key =
        standing.incoming == null
          ? await mintSuccessor(relationId, standing.signing.keyId)
          : // A retry offers the SAME key again, so that what the peer ends up
            // holding is the key this proxy will actually sign with.
            await registrationFor(relationId, standing.incoming);
    } catch {
      return {
        relationId,
        newKeyId: standing.incoming?.keyId ?? null,
        delivery: { ok: false, reason: 'key-unavailable' },
      };
    }

    // `op` is stamped here, never taken from a caller: its declared type admits
    // the GROWI -> proxy direction too, and it is a signed, routing value.
    const request: KeyRegistrationRequest = {
      relationId,
      op: OP_NAMES.keyRegisterToGrowi,
      key,
    };

    const outcome = await deliver(() => send(growiUri, request));
    if (!outcome.ok) {
      return {
        relationId,
        newKeyId: key.keyId,
        delivery: { ok: false, reason: outcome.reason },
      };
    }

    // Recorded only now: `delivered_to_peer_at` is what step 4 reads, so
    // writing it before the peer accepted would let the old key be revoked
    // while that GROWI still holds nothing but the old one.
    await ownKeys.markDeliveredToPeer({ relationId, keyId: key.keyId }, now());
    return { relationId, newKeyId: key.keyId, delivery: { ok: true } };
  };

  return {
    issue: async (relationId) => {
      const { publicKey, privateKey } =
        generateKeyPairSync(SIGNATURE_ALGORITHM);
      const keyId = generateKeyId();

      await ownKeys.issue(relationId, {
        keyId,
        privateKeyPem: privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
        validFrom: now(),
        // Not a rotation: this is the relation's first key. `rotate` is what
        // fills this column in.
        supersededKeyId: null,
      });

      return { keyId, publicKeyJwk: publicKey.export({ format: 'jwk' }) };
    },

    // Mid-rotation this answers with the OLD key, because that is the key the
    // peer holds and the key this proxy signs with -- which is what a repeated
    // pairing submission has to be answered with. Before rotation existed,
    // `currentKey` refused outright in that state.
    publicKeyFor: async (relationId) =>
      registrationFor(relationId, (await currentKey(relationId)).record),

    signerFor: async (relationId) => (await currentKey(relationId)).signer,

    rotate: async (installationId, send) => {
      const results: RotationResult[] = [];
      // One relation at a time rather than all at once: the result is a list an
      // operator reads against their GROWIs, and a rotation is a rare,
      // deliberately paced operation -- there is nothing to win by letting
      // timing decide the order.
      for (const relation of await relations.listByInstallation(
        installationId,
      )) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose -- see the comment above.
        results.push(await rotateOne(relation, send));
      }
      return results;
    },

    rotationStatus: async (installationId) => {
      const statuses: RotationStatus[] = [];
      for (const relation of await relations.listByInstallation(
        installationId,
      )) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential so the list reads in a stable order, as `rotate` does.
        const standing = await standingFor(relation.relationId);
        statuses.push({
          relationId: relation.relationId,
          growiLabel: relation.growiLabel,
          newKeyId:
            standing.kind === 'ok' ? (standing.incoming?.keyId ?? null) : null,
          deliveredToPeer:
            standing.kind === 'ok' &&
            standing.incoming?.deliveredToPeerAt != null,
          problem: standing.kind === 'ok' ? null : standing.kind,
        });
      }
      return statuses;
    },

    revokeOldIfAllDelivered: async (installationId, send) => {
      // EVERY relation is read before anything is sent: 「全員に届いたときだけ」
      // cannot be judged one relation at a time, and a single undelivered key
      // has to stop the revocation for the whole installation -- including for
      // the relations that are ready.
      const due: Array<{
        readonly relationId: string;
        readonly growiUri: string;
        readonly oldKeyId: string;
      }> = [];
      for (const relation of await relations.listByInstallation(
        installationId,
      )) {
        // The loop stops at the first relation that is not ready, so the reads
        // after it are ones this must NOT make.
        // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose
        const standing = await standingFor(relation.relationId);
        if (standing.kind !== 'ok') {
          // Whether this relation has a rotation under way is unknowable, so
          // 「全員に届いた」 cannot be claimed. The whole installation waits
          // rather than revoke around it.
          return false;
        }
        if (standing.incoming == null) {
          continue; // no rotation under way here, so nothing to revoke
        }
        if (standing.incoming.deliveredToPeerAt == null) {
          return false;
        }
        due.push({
          relationId: relation.relationId,
          growiUri: relation.growiUri,
          oldKeyId: standing.signing.keyId,
        });
      }

      if (due.length === 0) {
        return false;
      }

      let allRevoked = true;
      for (const { relationId, growiUri, oldKeyId } of due) {
        const request: KeyRevocationRequest = {
          relationId,
          op: OP_NAMES.keyRevokeToGrowi,
          keyId: oldKeyId,
        };

        // **Told first, revoked second** (design.md: 「古い鍵を失効させる前に、
        // 相手にも失効を伝える」). The other order would leave the GROWI holding
        // a public key this proxy has already stopped using, which is the very
        // thing the rotation exists to end.
        // Each iteration is a send followed by the local revoke it authorises;
        // running them all at once would interleave those two halves across
        // relations.
        // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose
        const outcome = await deliver(
          () => send(growiUri, request),
          REVOCATION_ALREADY_DONE,
        );
        if (!outcome.ok) {
          // `would-leave-no-valid-key` stops the revoke on purpose: it is the
          // peer saying the new key never landed there, whatever this proxy
          // recorded, so revoking now would sign every later request with a key
          // it does not hold.
          allRevoked = false;
          continue;
        }
        await ownKeys.revoke({ relationId, keyId: oldKeyId }, now());
      }
      return allRevoked;
    },
  };
};
