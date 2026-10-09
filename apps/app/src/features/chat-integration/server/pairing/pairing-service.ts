// The outbound half of the pairing procedure -- steps 1-4 and 6 (design.md
// "ペアリングの途中に、自分の鍵を置く場所が要る（順序の矛盾）"; Requirements 9.1,
// 9.4, 9.5, 9.7) -- plus unpairing.
//
// This is the counterpart of `pairing-endpoint.ts` in the same directory:
// that file answers the ownership challenge the proxy sends INTO this GROWI
// (step 5); this one drives everything GROWI itself initiates. They share the
// `chat_pending_pairings` row and nothing else, which is why they are
// siblings rather than one module.
//
// The order below is forced by the protocol, not chosen:
//
//   1. an administrator pastes a registration code the proxy issued
//   2. GROWI generates its own key pair for this attempt and records it as a
//      PENDING row -- it cannot go into `chat_integration_keys` yet, whose key
//      axis is `relationId`, and no `relationId` exists until step 6
//   3. GROWI submits the code plus its own PUBLIC key to the proxy
//   4. while step 3's request is still open, the proxy calls back with an
//      ownership challenge, which `pairing-endpoint.ts` answers using the
//      pending row's private key
//   6. step 3's response carries the `PairingResult`; on success the pending
//      key moves into `chat_integration_keys` as this relation's own key, the
//      proxy's public key is stored as the peer key, and the pending row goes
//
// So the pending row MUST be written before the network call, not after it --
// a row written afterwards would never be there when step 4 arrives, and the
// pairing would fail every single time with nothing pointing at why.

import { generateKeyPairSync, type KeyObject, randomUUID } from 'node:crypto';
import type { PairingResult, PairingSubmission } from '@growi/chat';
import type mongoose from 'mongoose';

import {
  encryptChatKeyForStorage,
  isChatKeyEncryptionConfigured,
  storeOwnKey,
  storePeerKey,
} from '../keys';
import { ChatIntegrationKey } from '../keys/models/chat-integration-key';
import { ChatNotificationDestination } from '../models/chat-notification-destination';
import { ChatRelation } from '../models/chat-relation';
import type { ProxyCallFailure } from '../proxy-client';
import { submitPairing } from '../proxy-client';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import type { AccountLinkInheritance } from './inherit-account-links';
import { inheritAccountLinks } from './inherit-account-links';
import { ChatPendingPairing } from './models/pending-pairing';

/**
 * How long a pending pairing row stays usable. Matches the registration
 * code's own lifetime on the proxy side (`@growi/chat`'s
 * `DEFAULT_REGISTRATION_TTL_SEC`): the row is worthless once the code it
 * names has expired, and `chat_pending_pairings.expiresAt` carries a TTL
 * index, so an abandoned attempt clears itself.
 */
export const PENDING_PAIRING_TTL_SEC = 600;

export interface SubmitPairingParams {
  /** The code the proxy issued and the administrator pasted into GROWI. */
  readonly registrationCode: string;
  /** Base URI of the proxy to submit to. Becomes `chat_relations.proxyUri`. */
  readonly proxyUri: string;
  /**
   * This GROWI's own URL as the administrator typed it. Declared to the proxy
   * so it can call back for the ownership challenge -- and deliberately NOT
   * part of anything signed (design.md: the two sides' spellings of it drift).
   */
  readonly growiUri: string;
  readonly growiLabel: string;
  readonly createdBy: mongoose.Types.ObjectId;
}

/**
 * Why a pairing attempt ended the way it did. Every variant is something an
 * administrator has to be shown differently, which is the whole point of
 * keeping them apart: "the proxy says you are already paired", "the code has
 * expired", "your URL could not be verified" and "the proxy could not be
 * reached" all need different next steps from the operator, and design.md
 * requires the two collision cases in particular to be reported rather than
 * silently swallowed ("既にある関係の識別子が返ってきたら成立させず、管理者に
 * 知らせる").
 */
export type PairingOutcome =
  | {
      readonly status: 'paired';
      readonly relationId: string;
      readonly inheritance: AccountLinkInheritance;
    }
  /**
   * The proxy handed back a `relationId` this GROWI already has a row for.
   * The pairing is NOT established: writing it would either overwrite a live
   * relation's `proxyUri` or, worse, register this proxy's public key as the
   * peer key of an unrelated relation -- the exact impersonation design.md's
   * single-column-unique reasoning exists to prevent.
   */
  | { readonly status: 'relation-already-known'; readonly relationId: string }
  /** Requirement 8.5: the proxy refuses to pair the same GROWI twice. */
  | { readonly status: 'already-paired'; readonly detail: string }
  /** Requirement 9.4: the registration code had already expired. */
  | { readonly status: 'code-expired' }
  /** Requirement 9.3: the proxy could not confirm this GROWI owns `growiUri`. */
  | { readonly status: 'ownership-unverified'; readonly detail: string }
  /** The call itself never produced an answer this GROWI may act on. */
  | { readonly status: 'call-failed'; readonly reason: ProxyCallFailure }
  /**
   * `CHAT_INTEGRATION_KEY_ENCRYPTION_KEY` is unset or unusable, so the
   * private key would have to be stored in the clear. design.md: "未設定なら
   * ペアリングを始められない。平文で保存に落とさない" -- refused before anything
   * is written or sent.
   */
  | { readonly status: 'key-encryption-unconfigured' };

export interface PairingSubmissionDeps {
  /**
   * The network call. Injectable for the same reason
   * `pairing-endpoint.ts`'s `recordRateLimitExceeded` is: it is the one
   * boundary a test cannot run for real, and the alternative (module
   * mocking) would take `proxy-client.ts`'s own guarantees out of the picture
   * for every other function in it.
   */
  readonly submit?: typeof submitPairing;
}

/**
 * `PairingSubmission.publicKey.publicKeyJwk`, built field by field rather
 * than by handing over whatever `KeyObject.export` produced.
 *
 * `PublicKeyRegistration`'s own contract requires the registering side to
 * reject a key carrying a private component (`d`), and an Ed25519 public JWK
 * is exactly these three fields -- so composing it explicitly makes "no
 * private half on the wire" a property of the code rather than of a check
 * somewhere downstream.
 */
const toEd25519PublicJwk = (publicKey: KeyObject): JsonWebKey => {
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || jwk.x == null) {
    throw new Error(
      'pairing-service: generated key is not an Ed25519 public key',
    );
  }
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
};

/**
 * Records this attempt's key pair as pending and returns the public half to
 * declare, encrypted at rest by `encryptChatKeyForStorage` exactly as
 * `chat_pending_pairings`'s own schema validator requires.
 *
 * Any earlier row for the same registration code is replaced rather than
 * reused: `registrationCode` is unique, and an administrator retrying after a
 * failed attempt (the proxy was unreachable, say) must not be met with a
 * duplicate-key error. The replacement mints a fresh key pair, which is also
 * what makes the retry meaningful -- the previous attempt's public key may
 * already be registered on the proxy side.
 */
const recordPendingPairing = async (
  params: SubmitPairingParams,
  now: Date,
): Promise<{
  readonly keyId: string;
  readonly publicKeyJwk: JsonWebKey;
  readonly privateKey: KeyObject;
}> => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = randomUUID();

  await ChatPendingPairing.deleteMany({
    registrationCode: params.registrationCode,
  });
  // `.create()`, never an `updateOne`-style write: the `ownKeyPair` validator
  // that refuses an unencrypted value only runs on a document-path write
  // (see tasks.md Implementation Notes on `chat_integration_keys`).
  await ChatPendingPairing.create({
    registrationCode: params.registrationCode,
    proxyUri: params.proxyUri,
    growiUri: params.growiUri,
    createdBy: params.createdBy,
    ownKeyId: keyId,
    ownKeyPair: encryptChatKeyForStorage(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ),
    expiresAt: new Date(now.getTime() + PENDING_PAIRING_TTL_SEC * 1000),
  });

  return { keyId, publicKeyJwk: toEd25519PublicJwk(publicKey), privateKey };
};

/**
 * Moves the pending key pair into `chat_integration_keys` as this relation's
 * own key and stores the proxy's public key as the peer key -- design.md's
 * "⑥ で `PairingResult.relationId` を受け取った時点で `chat_integration_keys`
 * へ移し、保留の行は消す".
 *
 * The private key is handed in as the `KeyObject` this same attempt
 * generated, not read back out of the pending row: the pending row's copy
 * exists so that `pairing-endpoint.ts` -- a DIFFERENT request, which cannot
 * see this one's variables -- can answer step 4. Decrypting it again here
 * would add a second place that reads key plaintext for no gain
 * (`storeOwnKey` re-encrypts it for its own row either way).
 */
interface EstablishRelationInput {
  readonly params: SubmitPairingParams;
  readonly result: Extract<PairingResult, { status: 'paired' }>;
  readonly ownKeyId: string;
  readonly ownPrivateKey: KeyObject;
  readonly now: Date;
}

const establishRelation = async ({
  params,
  result,
  ownKeyId,
  ownPrivateKey,
  now,
}: EstablishRelationInput): Promise<void> => {
  // These 3 writes are deliberately NOT wrapped in one transaction --
  // storeOwnKey/storePeerKey take no session parameter, and changing that
  // would ripple into task 3.1's already-approved signature. The relation
  // row is written FIRST, on purpose: if the process dies between these
  // writes, "relation exists, a key is missing" still lets an operator
  // unpair (unpairRelation looks the relation up by relationId) and
  // re-pair to recover. Writing the relation row LAST instead would look
  // safer but is actually worse -- a key written with no relation row
  // leaves nothing to unpair, while the proxy already considers the
  // pairing done, so re-pairing would be refused as already-paired with
  // no way out. Keep this order if you ever refactor this function.
  await ChatRelation.create({
    relationId: result.relationId,
    proxyUri: params.proxyUri,
    platform: result.workspace.platform,
    workspaceId: result.workspace.workspaceId,
    workspaceName: result.workspace.workspaceName,
    // `label` is the administrator's own display name for this relation, set
    // from the admin screen later -- `growiLabel` is what GROWI calls ITSELF
    // to the proxy, a different thing entirely.
    label: null,
    state: 'active',
    settingsVersion: 0,
    createdAt: now,
  });

  await storeOwnKey(
    { relationId: result.relationId, keyId: ownKeyId },
    ownPrivateKey,
    now,
  );
  await storePeerKey(
    { relationId: result.relationId, keyId: result.publicKey.keyId },
    { ...result.publicKey.publicKeyJwk },
    new Date(result.publicKey.validFrom),
  );
};

/**
 * Runs a full pairing attempt: records the pending key, submits the
 * registration code with this GROWI's public key, and -- on success -- stores
 * the relation, both keys, and inherits the account links of the same
 * workspace's previously unpaired relation.
 *
 * The pending row survives a `call-failed` outcome on purpose. That is the
 * one failure where the proxy may not have processed the submission at all,
 * so the administrator can retry the same code (which replaces the row); for
 * every other outcome the code is spent and the row is removed immediately
 * instead of lingering until its TTL.
 */
export const submitPairingRequest = async (
  params: SubmitPairingParams,
  deps: PairingSubmissionDeps = {},
): Promise<PairingOutcome> => {
  const submit = deps.submit ?? submitPairing;
  const now = new Date();

  // Checked before anything is generated or written: the alternative is a
  // thrown `ChatKeyEncryptionConfigurationError` reaching the admin screen as
  // a bare 500, with nothing saying which environment variable is missing.
  if (!isChatKeyEncryptionConfigured()) {
    return { status: 'key-encryption-unconfigured' };
  }

  const pending = await recordPendingPairing(params, now);

  const submission: PairingSubmission = {
    registrationCode: params.registrationCode,
    growiUri: params.growiUri,
    growiLabel: params.growiLabel,
    publicKey: {
      keyId: pending.keyId,
      publicKeyJwk: pending.publicKeyJwk,
      validFrom: now.toISOString(),
    },
  };

  const called = await submit(params.proxyUri, submission);
  if (!called.ok) {
    return { status: 'call-failed', reason: called.reason };
  }

  const result = called.response;
  const discardPending = () =>
    ChatPendingPairing.deleteMany({
      registrationCode: params.registrationCode,
    });

  switch (result.status) {
    case 'code-expired':
      await discardPending();
      return { status: 'code-expired' };
    case 'ownership-unverified':
      await discardPending();
      return { status: 'ownership-unverified', detail: result.detail };
    case 'already-paired':
      await discardPending();
      return { status: 'already-paired', detail: result.detail };
  }

  const known = await ChatRelation.findOne({
    relationId: result.relationId,
  }).lean();
  if (known != null) {
    await discardPending();
    return { status: 'relation-already-known', relationId: result.relationId };
  }

  await establishRelation({
    params,
    result,
    ownKeyId: pending.keyId,
    ownPrivateKey: pending.privateKey,
    now,
  });
  await discardPending();

  const inheritance = await inheritAccountLinks({
    relationId: result.relationId,
    platform: result.workspace.platform,
    workspaceId: result.workspace.workspaceId,
  });

  return { status: 'paired', relationId: result.relationId, inheritance };
};

export type UnpairRelationResult = 'unpaired' | 'not-found';

/**
 * Requirement 9.7: stop serving this relation.
 *
 * The `chat_relations` row is NOT deleted -- only its `state` changes.
 * `platform` and `workspaceId` have to survive, because they are the only
 * thing a later re-pairing can recognize the same workspace by, and losing
 * them loses every user's account link with them (design.md: "行を消してしまう
 * と、古い relationId がどの workspace のものだったか分からなくなり、引き継げない").
 * Removing the row is the 90-day sweep's job, not this function's.
 *
 * What IS deleted is everything that would let traffic keep flowing or leak:
 * the keys (so no signature from either side verifies any more -- this is
 * what "以降その GROWI との間のリクエストを処理しない" actually rests on, and it
 * also means no private key is left at rest), the channel permissions, and
 * the notification destinations. `chat_account_links` is deliberately left
 * alone.
 */
export const unpairRelation = async (
  relationId: string,
  now: Date = new Date(),
): Promise<UnpairRelationResult> => {
  const relation = await ChatRelation.findOne({ relationId }).lean();
  if (relation == null) {
    return 'not-found';
  }

  // Filtered on `state: 'active'` so a second call never overwrites the
  // instant the 90-day sweep and the inheritance ordering both read.
  await ChatRelation.updateOne(
    { relationId, state: 'active' },
    { $set: { state: 'unpaired', unpairedAt: now } },
  );

  await Promise.all([
    ChatIntegrationKey.deleteMany({ relationId }),
    ChatChannelPermission.deleteMany({ relationId }),
    ChatNotificationDestination.deleteMany({ relationId }),
  ]);

  return 'unpaired';
};
