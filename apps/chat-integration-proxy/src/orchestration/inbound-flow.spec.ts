// The four things a GROWI asks this proxy to do, as business logic: post a
// notification, take a settings push, register a peer key, revoke a peer key.
// The HTTP edge (signature verification, body parsing) is `routes/`' job and
// is deliberately absent here -- every request below arrives already verified
// and already parsed, exactly as it will at run time.
//
// The three properties these tests exist for:
//
//  1. **A destination is judged from the saved inventory alone**, and the
//     three answers are kept apart: "not this workspace's channel", "the bot
//     is not in it" and "the inventory has never been fetched". design.md is
//     explicit that conflating them tells an operator to do the wrong thing.
//  2. **A retry does not post twice.** The record is per destination, so the
//     second run posts only where the first one failed -- and still answers
//     for every destination in the original list.
//  3. **A settings push older than what is stored changes nothing**, and the
//     version and the permissions move together or not at all.

import { generateKeyPairSync } from 'node:crypto';
import type {
  KeyRegistrationRequest,
  KeyRevocationRequest,
  NotificationRequest,
  PlatformName,
  SettingsPushRequest,
} from '@growi/chat';
import { OP_NAMES } from '@growi/chat';
import { type DeepMockProxy, mock, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import { createInboundFlow, type InboundFlowPlatform } from './inbound-flow.js';

const PLATFORM: PlatformName = 'slack';
const RELATION_ID = 'relation-1';
const INSTALLATION_ID = 'installation-1';
const NOW = new Date('2026-06-01T00:00:00.000Z');

const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => plaintext,
  decrypt: (ciphertext) => ciphertext,
};

const relationRow = {
  id: RELATION_ID,
  installationId: INSTALLATION_ID,
  growiUri: 'https://wiki.example.com/',
  growiLabel: 'wiki',
  searchWeight: 1,
  settingsVersion: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const installationRow = (channelsSyncedAt: Date | null) => ({
  id: INSTALLATION_ID,
  platform: PLATFORM,
  workspaceId: 'T1',
  workspaceName: 'Acme',
  credentials: 'cipher',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  channelsSyncedAt,
});

const channelRow = (channelId: string, platform: PlatformName = PLATFORM) => ({
  installationId: INSTALLATION_ID,
  platform,
  channelId,
  channelName: channelId.toLowerCase(),
  isPrivate: false,
  refreshedAt: new Date('2026-05-31T00:00:00.000Z'),
});

const notificationOf = (
  channelIds: ReadonlyArray<string>,
  requestId = 'req-1',
): NotificationRequest => ({
  relationId: RELATION_ID,
  op: OP_NAMES.notification,
  requestId,
  targets: channelIds.map((channelId) => ({ platform: PLATFORM, channelId })),
  markdown: '[Sandbox](https://wiki.example.com/Sandbox) が更新されました',
  containsRestrictedPage: false,
});

interface ProcessedRow {
  relationId: string;
  requestId: string;
  platform: string;
  channelId: string;
  status: string;
  detail: string | null;
  processedAt: Date;
  expiresAt: Date;
}

/**
 * A prisma mock whose `processed_notification_target` rows actually
 * accumulate. A retry is only meaningful against a store that remembers what
 * the first run wrote, and a mock that always answers the same rows cannot
 * tell "skipped because already posted" from "posted again".
 */
const createPrisma = (
  channels: ReadonlyArray<ReturnType<typeof channelRow>>,
  channelsSyncedAt: Date | null = new Date('2026-05-31T00:00:00.000Z'),
): DeepMockProxy<PrismaClient> => {
  const prisma = mockDeep<PrismaClient>();
  prisma.relation.findUnique.mockResolvedValue(relationRow);
  prisma.installation.findUnique.mockResolvedValue(
    installationRow(channelsSyncedAt),
  );

  // Every `as never` below is for the reason `relation-key-service.spec.ts`
  // documents: the delegates' generated generic query types may not be named
  // outside `db/` (architecture guard 3), so the implementations are written
  // against the narrow shape the repository actually sends.
  prisma.installationChannel.findUnique.mockImplementation(((args: {
    where: { installationId_channelId: { channelId: string } };
  }) =>
    Promise.resolve(
      channels.find(
        (row) =>
          row.channelId === args.where.installationId_channelId.channelId,
      ) ?? null,
    )) as never);

  let processed: ReadonlyArray<ProcessedRow> = [];
  prisma.processedNotificationTarget.findMany.mockImplementation(((args: {
    where: { relationId: string; requestId: string };
  }) =>
    Promise.resolve(
      processed.filter(
        (row) =>
          row.relationId === args.where.relationId &&
          row.requestId === args.where.requestId,
      ),
    )) as never);
  prisma.processedNotificationTarget.upsert.mockImplementation(((args: {
    create: ProcessedRow;
  }) => {
    const row = args.create;
    processed = [
      ...processed.filter(
        (existing) =>
          !(
            existing.relationId === row.relationId &&
            existing.requestId === row.requestId &&
            existing.platform === row.platform &&
            existing.channelId === row.channelId
          ),
      ),
      row,
    ];
    return Promise.resolve(row);
  }) as never);

  prisma.$transaction.mockImplementation(
    (arg: unknown) =>
      (arg as (tx: PrismaClient) => Promise<unknown>)(prisma) as never,
  );

  return prisma;
};

const flowOver = (
  prisma: PrismaClient,
  platform: InboundFlowPlatform,
  deadlines: {
    readonly notificationTargetTimeoutMs?: number;
    readonly notificationDeadlineMs?: number;
  } = {},
): ReturnType<typeof createInboundFlow> =>
  createInboundFlow({
    db: prisma,
    cipher: fakeCipher,
    platform,
    now: () => NOW,
    ...deadlines,
  });

const postingPlatform = () => {
  const platform = mock<InboundFlowPlatform>();
  platform.post.mockResolvedValue({ ok: true, messageId: 'M1' });
  return platform;
};

describe('notification -- which destinations may be posted to (Requirement 2.1, 2.4)', () => {
  it('posts to a channel of the relation s own installation', async () => {
    const prisma = createPrisma([channelRow('C1')]);
    const platform = postingPlatform();

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C1']),
    );

    expect(platform.post).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toEqual([
      { platform: PLATFORM, channelId: 'C1', status: 'posted' },
    ]);
  });

  it('refuses a channel that is not in this installation s saved inventory, without asking the chat service', async () => {
    // This is the one thing standing between a compromised GROWI and every
    // other channel of the workspace, so the refusal must happen BEFORE the
    // post rather than being reported after it.
    const prisma = createPrisma([channelRow('C1')]);
    const platform = postingPlatform();

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C-other']),
    );

    expect(platform.post).not.toHaveBeenCalled();
    expect(result.outcomes[0].status).toBe('channel-not-in-installation');
  });

  it('refuses a channel id that belongs to another chat service', async () => {
    // The saved inventory is addressed by `(installationId, channelId)`
    // alone, so a channel id that two services both use would otherwise pass
    // the check for the wrong service.
    const prisma = createPrisma([channelRow('C1', 'discord')]);
    const platform = postingPlatform();

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C1']),
    );

    expect(platform.post).not.toHaveBeenCalled();
    expect(result.outcomes[0].status).toBe('channel-not-in-installation');
  });

  it('says the inventory has never been fetched, rather than "no such channel"', async () => {
    // Answering `channel-not-in-installation` here sends the operator off to
    // re-create a channel that exists and is fine -- design.md calls this out
    // by name (Requirement 2.4).
    const prisma = createPrisma([], null);
    const platform = postingPlatform();

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C1']),
    );

    expect(platform.post).not.toHaveBeenCalled();
    expect(result.outcomes[0].status).toBe('inventory-not-ready');
  });

  it('answers "no such channel" -- not "not fetched yet" -- for a workspace whose inventory was fetched and found empty', async () => {
    // The mirror image of the test above, and the case that decides why
    // readiness is keyed off `channelsSyncedAt` alone rather than off "are
    // there any saved rows". A workspace really can have zero channels the
    // bot can see, and once its inventory HAS been fetched, that emptiness is
    // an answer, not a missing one. Judging readiness by whether any row
    // exists would leave such a workspace being told "not fetched yet"
    // forever, with nothing an operator could ever do to change it.
    const prisma = createPrisma([], new Date('2026-05-31T00:00:00.000Z'));
    const platform = postingPlatform();

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C1']),
    );

    expect(platform.post).not.toHaveBeenCalled();
    expect(result.outcomes[0].status).toBe('channel-not-in-installation');
  });

  it('keeps "the bot is not in the channel" apart from "not this workspace s channel"', async () => {
    // A public channel the bot was never invited to IS in the inventory, so
    // it reaches `post()` -- and only `post()` can report it. The remedy the
    // platform layer supplies is what tells the operator to invite the bot.
    const prisma = createPrisma([channelRow('C1')]);
    const platform = mock<InboundFlowPlatform>();
    platform.post.mockResolvedValue({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot to #general',
    });

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C1']),
    );

    expect(result.outcomes[0]).toEqual({
      platform: PLATFORM,
      channelId: 'C1',
      status: 'bot-not-in-channel',
      remedy: 'invite the bot to #general',
    });
  });

  it('reports a chat service failure as a platform error, with its detail', async () => {
    const prisma = createPrisma([channelRow('C1')]);
    const platform = mock<InboundFlowPlatform>();
    platform.post.mockResolvedValue({
      ok: false,
      reason: 'platform-error',
      detail: 'rate limited',
    });

    const result = await flowOver(prisma, platform).notify(
      notificationOf(['C1']),
    );

    expect(result.outcomes[0]).toEqual({
      platform: PLATFORM,
      channelId: 'C1',
      status: 'platform-error',
      detail: 'rate limited',
    });
  });
});

describe('notification -- retrying one that partly failed (Requirement 10.7)', () => {
  it('posts again only where it failed, and still answers for every destination', async () => {
    // The acceptance criterion of this task. Two separate assertions on
    // purpose: "re-posted to a destination that already succeeded" and
    // "answered for only the destinations tried this time" are different
    // faults, and one assertion would let either hide behind the other.
    const prisma = createPrisma([
      channelRow('C-a'),
      channelRow('C-b'),
      channelRow('C-c'),
    ]);
    const platform = mock<InboundFlowPlatform>();
    platform.post.mockImplementation((target) =>
      Promise.resolve(
        target.channelId === 'C-b'
          ? { ok: false, reason: 'platform-error', detail: 'rate limited' }
          : { ok: true, messageId: `M-${target.channelId}` },
      ),
    );
    const flow = flowOver(prisma, platform);
    const request = notificationOf(['C-a', 'C-b', 'C-c']);

    const first = await flow.notify(request);
    expect(platform.post).toHaveBeenCalledTimes(3);
    expect(first.outcomes.map((outcome) => outcome.status)).toEqual([
      'posted',
      'platform-error',
      'posted',
    ]);

    platform.post.mockClear();
    platform.post.mockResolvedValue({ ok: true, messageId: 'M-b' });

    const second = await flow.notify(request);

    expect(platform.post).toHaveBeenCalledTimes(1);
    expect(platform.post.mock.calls[0][0].channelId).toBe('C-b');
    expect(second.outcomes).toEqual([
      { platform: PLATFORM, channelId: 'C-a', status: 'posted' },
      { platform: PLATFORM, channelId: 'C-b', status: 'posted' },
      { platform: PLATFORM, channelId: 'C-c', status: 'posted' },
    ]);
  });

  it('records every destination it tried, keyed so one destination s record cannot overwrite another s', async () => {
    const prisma = createPrisma([channelRow('C-a'), channelRow('C-b')]);
    const platform = postingPlatform();

    await flowOver(prisma, platform).notify(notificationOf(['C-a', 'C-b']));

    const written = prisma.processedNotificationTarget.upsert.mock.calls.map(
      (call) => (call[0] as unknown as { create: ProcessedRow }).create,
    );
    expect(written.map((row) => row.channelId)).toEqual(['C-a', 'C-b']);
    expect(written.every((row) => row.requestId === 'req-1')).toBe(true);
  });
});

describe("notification -- the proxy's own deadline", () => {
  // `NotificationResult`'s `timeout` exists so a long target list cannot hold
  // GROWI's single request open (design.md 「`timeout` があるのは、宛先が多い
  // ときに GROWI の 1 リクエストが待たされないよう proxy 側にも締め切りを
  // 設けるため」). The values below are injected and tiny for the reason
  // `fan-out-collector.spec.ts` injects 20-30 ms ones: what is being tested is
  // that the caps exist and are obeyed, not what the shipped numbers are.
  const hangingOn = (hangingChannelIds: ReadonlyArray<string>) => {
    const platform = mock<InboundFlowPlatform>();
    platform.post.mockImplementation((channel) =>
      hangingChannelIds.includes(channel.channelId)
        ? // Never settles: the chat service accepted the call and went quiet.
          new Promise(() => {})
        : Promise.resolve({ ok: true, messageId: `M-${channel.channelId}` }),
    );
    return platform;
  };

  it('answers a destination that never responds as timeout, and still posts to the rest', async () => {
    const prisma = createPrisma([channelRow('C-silent'), channelRow('C-ok')]);
    const platform = hangingOn(['C-silent']);

    const result = await flowOver(prisma, platform, {
      notificationTargetTimeoutMs: 20,
      notificationDeadlineMs: 500,
    }).notify(notificationOf(['C-silent', 'C-ok']));

    // The silent destination is first on purpose: the destination behind it
    // is the one that proves the wait was given up rather than merely
    // survived.
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'timeout',
      'posted',
    ]);
  });

  it('stops posting once the whole request has run out of time, and answers the rest as timeout', async () => {
    // Three silent destinations against a whole-request budget shorter than
    // one destination's own cap. Without the whole-request budget the answer
    // would take three times the per-destination cap; without taking the
    // smaller of the two remaining budgets it would overshoot by a full
    // per-destination cap on the last destination it starts.
    const prisma = createPrisma([
      channelRow('C-1'),
      channelRow('C-2'),
      channelRow('C-3'),
    ]);
    const platform = hangingOn(['C-1', 'C-2', 'C-3']);

    const startedAt = Date.now();
    const result = await flowOver(prisma, platform, {
      notificationTargetTimeoutMs: 500,
      notificationDeadlineMs: 80,
    }).notify(notificationOf(['C-1', 'C-2', 'C-3']));
    const elapsedMs = Date.now() - startedAt;

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      'timeout',
      'timeout',
      'timeout',
    ]);
    expect(elapsedMs).toBeLessThan(300);
    // The destinations the deadline never reached are not posted to at all --
    // answering `timeout` for a post that was never attempted is what keeps
    // the whole answer inside the budget.
    expect(platform.post.mock.calls.length).toBeLessThan(3);
  });

  it('never records a timed-out destination as posted, so a later retry reaches it', async () => {
    // The record is the only thing that stops a retry from posting twice, so
    // a timeout recorded as a success would silently drop the notification
    // for good.
    const prisma = createPrisma([channelRow('C-silent')]);
    const platform = hangingOn(['C-silent']);
    const request = notificationOf(['C-silent']);

    const first = await flowOver(prisma, platform, {
      notificationTargetTimeoutMs: 20,
      notificationDeadlineMs: 500,
    }).notify(request);
    expect(first.outcomes[0].status).toBe('timeout');

    const written = prisma.processedNotificationTarget.upsert.mock.calls.map(
      (call) => (call[0] as unknown as { create: ProcessedRow }).create,
    );
    // A timeout leaves no record at all -- and above all never one saying
    // `posted`, which is the status a retry skips.
    expect(written).toEqual([]);

    const answering = postingPlatform();
    const second = await flowOver(prisma, answering, {
      notificationTargetTimeoutMs: 20,
      notificationDeadlineMs: 500,
    }).notify(request);

    expect(answering.post).toHaveBeenCalledTimes(1);
    expect(second.outcomes[0].status).toBe('posted');
  });

  it('still reports a destination an earlier attempt posted to, even with no time left at all', async () => {
    // The deadline must never cost a success that is already recorded. If the
    // budget were consulted BEFORE the record, a retry that arrives with the
    // budget gone would answer `timeout` for destinations that were posted to
    // -- and GROWI, writing the answer back into its outbox row, would erase
    // them. A zero budget is spent by the storage reads that precede the loop,
    // so this pins the order of the two checks.
    const prisma = createPrisma([channelRow('C-a'), channelRow('C-b')]);
    const platform = mock<InboundFlowPlatform>();
    platform.post.mockImplementation((channel) =>
      Promise.resolve(
        channel.channelId === 'C-b'
          ? { ok: false, reason: 'platform-error', detail: 'rate limited' }
          : { ok: true, messageId: 'M-a' },
      ),
    );
    const request = notificationOf(['C-a', 'C-b']);

    await flowOver(prisma, platform).notify(request);
    platform.post.mockClear();

    const retried = await flowOver(prisma, platform, {
      notificationDeadlineMs: 0,
    }).notify(request);

    expect(retried.outcomes.map((outcome) => outcome.status)).toEqual([
      'posted',
      'timeout',
    ]);
    expect(platform.post).not.toHaveBeenCalled();
  });
});

describe('settings-push (Requirement 11.4)', () => {
  const pushOf = (
    version: number,
    allowedChannels: ReadonlyArray<string> | 'all' | 'none',
  ): SettingsPushRequest => ({
    relationId: RELATION_ID,
    op: OP_NAMES.settingsPush,
    version,
    settings: {
      relationId: RELATION_ID,
      channelPermissions: [{ commandName: 'search', allowedChannels }],
    },
  });

  it('writes the pushed permissions when the version is newer', async () => {
    const prisma = createPrisma([]);
    prisma.relation.updateMany.mockResolvedValue({ count: 1 });
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 0 });

    await flowOver(prisma, postingPlatform()).pushSettings(pushOf(4, ['C1']));

    expect(prisma.relation.updateMany).toHaveBeenCalledWith({
      where: { id: RELATION_ID, settingsVersion: { lt: 4 } },
      data: { settingsVersion: 4 },
    });
    expect(prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          commandName: 'search',
          channels: ['C1'],
          allowAll: false,
        }),
      }),
    );
  });

  it('writes nothing at all when the push is not newer than what is stored', async () => {
    // A late retry of an older save must not undo the newer one. The
    // comparison is the condition ON the update, so "no row matched" is what
    // stops the rest.
    const prisma = createPrisma([]);
    prisma.relation.updateMany.mockResolvedValue({ count: 0 });

    await flowOver(prisma, postingPlatform()).pushSettings(pushOf(2, ['C1']));

    expect(prisma.channelPermission.upsert).not.toHaveBeenCalled();
    expect(prisma.channelPermission.deleteMany).not.toHaveBeenCalled();
  });

  it("stores 'all' as itself, never as a list", async () => {
    // Task 5.3's hand-off: an empty list already means "no channel
    // permitted", so writing `'all'` as one inverts the setting.
    const prisma = createPrisma([]);
    prisma.relation.updateMany.mockResolvedValue({ count: 1 });
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 0 });

    await flowOver(prisma, postingPlatform()).pushSettings(pushOf(4, 'all'));

    expect(prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ allowAll: true, channels: [] }),
      }),
    );
  });

  it("stores 'none' as an empty list, which is the same judgement", async () => {
    const prisma = createPrisma([]);
    prisma.relation.updateMany.mockResolvedValue({ count: 1 });
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 0 });

    await flowOver(prisma, postingPlatform()).pushSettings(pushOf(4, 'none'));

    expect(prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ allowAll: false, channels: [] }),
      }),
    );
  });

  it('drops the rows the push no longer mentions', async () => {
    // GROWI sends the whole settings object every time, so a command whose
    // row is gone from the push is a permission that was REMOVED. Upserting
    // only what arrived would leave the removed one in force.
    const prisma = createPrisma([]);
    prisma.relation.updateMany.mockResolvedValue({ count: 1 });
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 2 });

    await flowOver(prisma, postingPlatform()).pushSettings(pushOf(4, ['C1']));

    expect(prisma.channelPermission.deleteMany).toHaveBeenCalledWith({
      where: { relationId: RELATION_ID },
    });
  });

  it('moves the version and the permissions in one unit of work', async () => {
    // A crash between the two would leave the version claiming settings that
    // were never written, and every later push at that version or below is
    // then discarded -- stale for good, with nothing to fix it but the
    // database.
    const prisma = createPrisma([]);
    prisma.relation.updateMany.mockResolvedValue({ count: 1 });
    prisma.channelPermission.deleteMany.mockResolvedValue({ count: 0 });

    await flowOver(prisma, postingPlatform()).pushSettings(pushOf(4, ['C1']));

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('key-register-to-proxy (Requirement 10.5)', () => {
  const publicKeyJwk = generateKeyPairSync('ed25519').publicKey.export({
    format: 'jwk',
  });

  const registrationOf = (
    key: Record<string, unknown>,
    keyId = 'growi-key-1',
    validFrom = '2026-06-01T00:00:00.000Z',
  ): KeyRegistrationRequest => ({
    relationId: RELATION_ID,
    op: OP_NAMES.keyRegisterToProxy,
    key: {
      keyId,
      publicKeyJwk: key,
      validFrom,
    },
  });

  it('stores the GROWI s public key and answers ok', async () => {
    const prisma = createPrisma([]);

    await expect(
      flowOver(prisma, postingPlatform()).registerPeerKey(
        registrationOf(publicKeyJwk),
      ),
    ).resolves.toEqual({ status: 'ok' });
    expect(prisma.peerKey.upsert).toHaveBeenCalled();
  });

  it('refuses key material that is not an Ed25519 public key, and stores nothing', async () => {
    const prisma = createPrisma([]);

    await expect(
      flowOver(prisma, postingPlatform()).registerPeerKey(
        registrationOf({ kty: 'RSA', n: 'AA', e: 'AQAB' }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid-key' });
    expect(prisma.peerKey.upsert).not.toHaveBeenCalled();
  });

  it('refuses a private key offered as a public one', async () => {
    const prisma = createPrisma([]);

    await expect(
      flowOver(prisma, postingPlatform()).registerPeerKey(
        registrationOf({ ...publicKeyJwk, d: 'secret' }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid-key' });
    expect(prisma.peerKey.upsert).not.toHaveBeenCalled();
  });

  it('refuses a validFrom that is not a date, and stores nothing', async () => {
    // Everything else about this request is valid -- real key material, a
    // keyId with no colon in it -- so the only thing that can refuse it is
    // the check on `validFrom`. Without that check the string would be
    // handed to the repository, turned into a date that is not a date, and
    // written into a date column; from then on nothing can say whether the
    // key has started being valid.
    const prisma = createPrisma([]);

    await expect(
      flowOver(prisma, postingPlatform()).registerPeerKey(
        registrationOf(publicKeyJwk, 'growi-key-1', 'not-a-date'),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid-key' });
    expect(prisma.peerKey.upsert).not.toHaveBeenCalled();
  });

  it('refuses a keyId whose shape would break how a key is addressed', async () => {
    // `:` separates the two halves of the signature header's `keyid`, so a
    // keyId containing one pairs the GROWI into a relation whose every later
    // signed request is refused with no visible reason.
    const prisma = createPrisma([]);

    await expect(
      flowOver(prisma, postingPlatform()).registerPeerKey(
        registrationOf(publicKeyJwk, 'has:colon'),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid-key' });
    expect(prisma.peerKey.upsert).not.toHaveBeenCalled();
  });
});

describe('key-revoke-to-proxy (Requirement 10.5)', () => {
  const revocationOf = (keyId: string): KeyRevocationRequest => ({
    relationId: RELATION_ID,
    op: OP_NAMES.keyRevokeToProxy,
    keyId,
  });

  const peerKeyRow = (keyId: string, revokedAt: Date | null = null) => ({
    id: `peer-${keyId}`,
    relationId: RELATION_ID,
    keyId,
    publicKeyJwk: {},
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    revokedAt,
  });

  it('refuses a revocation that would leave the relation with no valid key', async () => {
    // The judgement itself is `@growi/chat`'s, so that this proxy and GROWI
    // cannot come to different answers about the same key list.
    const prisma = createPrisma([]);
    prisma.peerKey.findMany.mockResolvedValue([peerKeyRow('only-key')]);

    await expect(
      flowOver(prisma, postingPlatform()).revokePeerKey(
        revocationOf('only-key'),
      ),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'would-leave-no-valid-key',
    });
    expect(prisma.peerKey.update).not.toHaveBeenCalled();
  });

  it('refuses a key it does not hold', async () => {
    const prisma = createPrisma([]);
    prisma.peerKey.findMany.mockResolvedValue([peerKeyRow('key-1')]);

    await expect(
      flowOver(prisma, postingPlatform()).revokePeerKey(revocationOf('key-9')),
    ).resolves.toEqual({ status: 'rejected', reason: 'unknown-key' });
    expect(prisma.peerKey.update).not.toHaveBeenCalled();
  });

  it('revokes when another valid key remains', async () => {
    const prisma = createPrisma([]);
    prisma.peerKey.findMany.mockResolvedValue([
      peerKeyRow('key-old'),
      peerKeyRow('key-new'),
    ]);
    prisma.peerKey.update.mockResolvedValue(peerKeyRow('key-old', NOW));

    await expect(
      flowOver(prisma, postingPlatform()).revokePeerKey(
        revocationOf('key-old'),
      ),
    ).resolves.toEqual({ status: 'ok' });
    expect(prisma.peerKey.update).toHaveBeenCalledWith({
      where: {
        relationId_keyId: { relationId: RELATION_ID, keyId: 'key-old' },
      },
      data: { revokedAt: NOW },
    });
  });
});
