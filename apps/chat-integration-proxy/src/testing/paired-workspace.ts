// The stored rows that make a chat workspace and a GROWI able to talk to each
// other, for the end-to-end tests (tasks.md 11.2 onwards).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// Task 11.2 wrote these helpers inside `command-flow-e2e.integ.ts` and its
// Implementation Note said to move them here as soon as a second file needed
// them; 11.3 is that file. They are gathered by what they BUILD -- one paired
// workspace -- and not by "things a test happens to need": the connection
// strings and the `ProxyConfig` each integ file boots with stay with that
// file, since what they describe is the process under test rather than the
// contents of the database.
//
// **The two signing directions are separate helpers on purpose.** `pairGrowi`
// mints the `own_key` this proxy signs OUTGOING requests with (commands,
// searches); `trustGrowiSignature` stores the fake GROWI's public half as a
// `peer_key`, which is what lets a signed request travel the other way, INTO
// this proxy. A test needs whichever direction it actually drives, and a
// single helper doing both would leave every reader guessing which one the
// case under test depended on.

import {
  type JsonWebKey as CryptoJsonWebKey,
  createPublicKey,
  randomUUID,
} from 'node:crypto';
import type { ChannelRef, ChatAccountRef, PlatformName } from '@growi/chat';
import { COMMAND_NAMES } from '@growi/chat';

import {
  createChannelPermissionRepository,
  createInstallationChannelRepository,
  createInstallationRepository,
  createPeerKeyRepository,
  createRelationRepository,
  type PrismaClient,
} from '../db/index.js';
import { createRelationKeyService } from '../relation/index.js';
import { actorOn, channelOn } from './chat-events.js';
import type { FakeGrowi } from './fake-growi.js';

/** A cipher that leaves values readable: what it protects is not under test. */
export const passthroughCipher = {
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
};

export interface Workspace {
  readonly installationId: string;
  readonly channel: ChannelRef;
  readonly actor: ChatAccountRef;
}

/**
 * Adds one channel to a workspace's saved inventory.
 *
 * The row is NOT optional dressing: `resolveInstallationId`
 * (`runtime/dependencies.ts`) turns a `ChannelRef` into an installation by
 * looking the channel up here, and `InboundFlow.notify` judges every
 * notification destination against these same rows.
 *
 * The channel id is fresh per call rather than the harness's fixed one:
 * `pending_collection` enforces 「1 チャンネル・1 利用者につき同時に 1 件」
 * against a PERSISTENT database, so a row left behind by an earlier test --
 * or an earlier run -- would make the next `start` discard it and post a
 * notice, in front of the post the test is reading.
 */
export const addChannel = async (
  db: PrismaClient,
  installationId: string,
  platform: PlatformName,
): Promise<ChannelRef> => {
  const channel = channelOn(platform, { channelId: `chan-${randomUUID()}` });
  await createInstallationChannelRepository(db).upsert({
    installationId,
    platform,
    channelId: channel.channelId,
    channelName: channel.channelName,
    isPrivate: channel.isPrivate,
    refreshedAt: new Date(),
  });
  return channel;
};

/**
 * One chat workspace this proxy knows, with one channel the bot can be
 * addressed in and one actor to address it.
 *
 * The actor gets a fresh id for the same reason the channel does.
 */
export const openWorkspace = async (
  db: PrismaClient,
  platform: PlatformName,
): Promise<Workspace> => {
  const installationId = await createInstallationRepository(
    db,
    passthroughCipher,
  ).save(platform, `W-${randomUUID()}`, `${platform} workspace`, {});

  return {
    installationId,
    channel: await addChannel(db, installationId, platform),
    actor: actorOn(platform, { accountId: `user-${randomUUID()}` }),
  };
};

/**
 * Records that this proxy has fetched the workspace's channel list at least
 * once.
 *
 * `InboundFlow.notify` reads `channels_synced_at` alone to tell 「まだ一覧を
 * 取れていない」 (`inventory-not-ready`) from 「その一覧にこのチャンネルは
 * 無い」 (`channel-not-in-installation`), so without this every destination is
 * answered `inventory-not-ready` no matter how many rows `addChannel` wrote.
 */
export const markInventoryReady = (
  db: PrismaClient,
  installationId: string,
): Promise<void> =>
  createInstallationRepository(db, passthroughCipher).markChannelsSynced(
    installationId,
    new Date(),
  );

/**
 * Pairs one fake GROWI with the workspace and lets this proxy sign requests
 * TO it.
 *
 * Both halves are needed and neither is decoration: `RelationKeyService.issue`
 * mints the `own_key` this proxy signs with (without it `GrowiClient` answers
 * `no-signing-key` and the user reads 「届きませんでした」), and handing its
 * PUBLIC half to the fake GROWI is what lets that side's real `verify()`
 * accept the request. The private half never leaves `own-key-repository`.
 */
export const pairGrowi = async (
  db: PrismaClient,
  installationId: string,
  growi: FakeGrowi,
  growiLabel: string,
): Promise<string> => {
  const relation = await createRelationRepository(db).create({
    installationId,
    growiUri: growi.baseUrl,
    growiLabel,
    searchWeight: 1,
    settingsVersion: 1,
  });
  const issued = await createRelationKeyService({
    db,
    cipher: passthroughCipher,
  }).issue(relation.relationId);

  growi.registerPeerKey({
    key: { relationId: relation.relationId, keyId: issued.keyId },
    // `node:crypto` declares its own `JsonWebKey` (an index-signature-bearing
    // record) separately from the global one the contract type uses, so the
    // issued key is named as the former here -- the same step
    // `peer-key-repository.ts` takes for the other side's keys.
    publicKey: createPublicKey({
      key: issued.publicKeyJwk as CryptoJsonWebKey,
      format: 'jwk',
    }),
  });

  return relation.relationId;
};

/**
 * Lets the fake GROWI sign requests INTO this proxy for that relation.
 *
 * `signatureGuard` resolves a signature against the `peer_key` rows of the
 * relation the envelope names, so without this every inbound call is refused
 * 401 before any endpoint runs.
 */
export const trustGrowiSignature = (
  db: PrismaClient,
  relationId: string,
  growi: FakeGrowi,
): Promise<void> =>
  createPeerKeyRepository(db).register(relationId, {
    keyId: growi.ownKey.keyId,
    publicKeyJwk: growi.ownKey.publicKey.export({ format: 'jwk' }),
    validFrom: new Date(0).toISOString(),
  });

/**
 * Lets this channel run a WRITE command against that GROWI.
 *
 * `judge` denies a write command that has no stored row (`no-settings`) and
 * allows a read one, so a read command left without a row is not an omission
 * -- that absence is the ordinary state of a freshly paired GROWI. Notification
 * destinations are not gated by this table at all: `InboundFlow.notify` judges
 * them against the saved channel inventory alone.
 */
export const permitWrite = (
  db: PrismaClient,
  relationId: string,
  channelId: string,
): Promise<void> =>
  createChannelPermissionRepository(db).upsert(
    relationId,
    COMMAND_NAMES.createPage,
    [channelId],
  );
