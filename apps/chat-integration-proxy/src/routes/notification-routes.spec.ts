// The two endpoints a GROWI pushes work to: a notification to post, and a
// settings save to take (design.md's 「GROWI から届く口」 rows `notification`
// and `settings-push`; Requirements 2.1, 2.2, 10.7, 11.4).
//
// **Everything below goes through a real Hono app, a real Ed25519 signature
// and the real `createInboundFlow`.** The only doubles are the PostgreSQL
// client and `PlatformFacade.post`. That is deliberate: the properties this
// file exists for are properties of the WIRING, and every one of them
// survives a test that stubs the piece it is about.
//
//  - **The guard is mounted.** An unsigned request must never reach
//    `InboundFlow`. If the module took a ready-made middleware as an
//    argument, this test would be asserting the middleware the test itself
//    supplied -- task 8.1's recorded hand-off (a) is exactly that gap, and it
//    is closed here for these two paths by having the module build its own
//    guard from `SignatureGuardDeps`.
//  - **A retry does not post twice.** Asserted end to end over HTTP with the
//    real flow, because a stubbed `InboundFlow` that skipped already-posted
//    destinations would be asserting itself.
//  - **A body whose bytes no `JSON.stringify` would produce is still
//    accepted.** That is the visible half of the guard reading raw bytes; the
//    endpoint must not undo it. (The other half -- that the endpoint acts on
//    the value the guard already parsed rather than parsing again -- has no
//    observable difference to assert against, since both parses read the same
//    cached bytes. It is held by the module's shape, not by this file.)

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { PlatformName } from '@growi/chat';
import { OP_NAMES } from '@growi/chat';
import type { KeyRef, VerifyFailure } from '@growi/chat/server';
import { sign } from '@growi/chat/server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mock, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import {
  createInboundFlow,
  type InboundFlowPlatform,
} from '../orchestration/index.js';
import type { SecretCipher } from '../types/index.js';
import {
  type NotificationRoutesDeps,
  registerNotificationRoutes,
} from './notification-routes.js';
import type { SignedRequestEnv } from './signature-guard.js';

const NOTIFICATION_PATH = '/chat-integration/notification';
const SETTINGS_PUSH_PATH = '/chat-integration/settings-push';
const CONTENT_TYPE = 'application/json';

const PLATFORM: PlatformName = 'slack';
const RELATION_ID = 'relation-1';
const INSTALLATION_ID = 'installation-1';
const KEY: KeyRef = { relationId: RELATION_ID, keyId: 'key-1' };
const STORED_SETTINGS_VERSION = 3;

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => plaintext,
  decrypt: (ciphertext) => ciphertext,
};

// ---------------------------------------------------------------------------
// The storage double
//
// Trimmed to the delegates these two endpoints reach, and NOT extracted into
// something `orchestration/inbound-flow.spec.ts` could share: a fixture both
// files import would sit outside this task's `_Boundary: routes（通知と設定）_`,
// and the two specs want different things from it (that one drives the flow
// directly, this one drives it through HTTP and needs the settings version to
// actually move).
//
// Every `as never` is for the reason `inbound-flow.spec.ts` documents: the
// generated query types may not be named outside `db/` (architecture guard
// 3), so each implementation is written against the narrow shape the
// repository actually sends.
// ---------------------------------------------------------------------------

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

const channelRow = (channelId: string) => ({
  installationId: INSTALLATION_ID,
  platform: PLATFORM,
  channelId,
  channelName: channelId.toLowerCase(),
  isPrivate: false,
  refreshedAt: new Date('2026-05-31T00:00:00.000Z'),
});

const createPrisma = (
  channels: ReadonlyArray<ReturnType<typeof channelRow>>,
): DeepMockProxy<PrismaClient> => {
  const prisma = mockDeep<PrismaClient>();

  let settingsVersion = STORED_SETTINGS_VERSION;

  prisma.relation.findUnique.mockImplementation((() =>
    Promise.resolve({
      id: RELATION_ID,
      installationId: INSTALLATION_ID,
      growiUri: 'https://wiki.example.com/',
      growiLabel: 'wiki',
      searchWeight: 1,
      settingsVersion,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })) as never);
  prisma.installation.findUnique.mockResolvedValue({
    id: INSTALLATION_ID,
    platform: PLATFORM,
    workspaceId: 'T1',
    workspaceName: 'Acme',
    credentials: 'cipher',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    channelsSyncedAt: new Date('2026-05-31T00:00:00.000Z'),
  });

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

  // The stored version really moves, so a repeated push is discarded by the
  // same comparison that would discard it in PostgreSQL rather than by a
  // canned `count`.
  prisma.relation.updateMany.mockImplementation(((args: {
    where: { settingsVersion: { lt: number } };
    data: { settingsVersion: number };
  }) => {
    if (settingsVersion >= args.where.settingsVersion.lt) {
      return Promise.resolve({ count: 0 });
    }
    settingsVersion = args.data.settingsVersion;
    return Promise.resolve({ count: 1 });
  }) as never);
  prisma.channelPermission.deleteMany.mockResolvedValue({ count: 0 });
  prisma.channelPermission.upsert.mockImplementation(((args: {
    create: unknown;
  }) => Promise.resolve(args.create)) as never);

  prisma.$transaction.mockImplementation(
    (arg: unknown) =>
      (arg as (tx: PrismaClient) => Promise<unknown>)(prisma) as never,
  );

  return prisma;
};

// ---------------------------------------------------------------------------
// Signing, exactly as the GROWI side does it
// ---------------------------------------------------------------------------

const signedRequest = (options: {
  readonly path: string;
  readonly bodyText: string;
  readonly nonce?: string;
}): Request => {
  const bytes = new TextEncoder().encode(options.bodyText);
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
    key: KEY,
    privateKey,
    expiresInSec: 60,
    nonce: options.nonce,
  });
  return new Request(`http://proxy.example${options.path}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
    body: bytes,
  });
};

const unsignedRequest = (path: string, bodyText: string): Request =>
  new Request(`http://proxy.example${path}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bodyText,
  });

const notificationBody = (
  channelIds: ReadonlyArray<string>,
  overrides: { readonly requestId?: string; readonly markdown?: string } = {},
): string =>
  JSON.stringify({
    relationId: RELATION_ID,
    op: OP_NAMES.notification,
    requestId: overrides.requestId ?? 'req-1',
    targets: channelIds.map((channelId) => ({ platform: PLATFORM, channelId })),
    markdown:
      overrides.markdown ?? '[Sandbox](https://wiki.example.com/Sandbox)',
    containsRestrictedPage: false,
  });

const settingsPushBody = (
  version: number,
  allowedChannels: ReadonlyArray<string> | 'all' | 'none' = ['C1'],
): string =>
  JSON.stringify({
    relationId: RELATION_ID,
    op: OP_NAMES.settingsPush,
    version,
    settings: {
      relationId: RELATION_ID,
      channelPermissions: [{ commandName: 'search', allowedChannels }],
    },
  });

// ---------------------------------------------------------------------------

interface Harness {
  readonly app: Hono<SignedRequestEnv>;
  readonly prisma: DeepMockProxy<PrismaClient>;
  readonly platform: ReturnType<typeof mock<InboundFlowPlatform>>;
  readonly recordFailure: ReturnType<
    typeof vi.fn<(failure: VerifyFailure, ctx: unknown) => Promise<void>>
  >;
}

const createHarness = (
  channels: ReadonlyArray<ReturnType<typeof channelRow>> = [],
): Harness => {
  const prisma = createPrisma(channels);
  const platform = mock<InboundFlowPlatform>();
  platform.post.mockResolvedValue({ ok: true, messageId: 'M1' });

  const seenNonces = new Set<string>();
  const recordFailure = vi.fn<
    (failure: VerifyFailure, ctx: unknown) => Promise<void>
  >(async () => undefined);

  const deps: NotificationRoutesDeps = {
    signature: {
      resolvePublicKey: (): Promise<KeyObject | null> =>
        Promise.resolve(publicKey),
      consumeNonce: (ref, nonce) => {
        const token = `${ref.relationId}/${ref.keyId}/${nonce}`;
        if (seenNonces.has(token)) {
          return Promise.resolve(false);
        }
        seenNonces.add(token);
        return Promise.resolve(true);
      },
      recordFailure,
    },
    inboundFlow: createInboundFlow({
      db: prisma,
      cipher: fakeCipher,
      platform,
    }),
  };

  const app = new Hono<SignedRequestEnv>();
  registerNotificationRoutes(app, deps);

  return { app, prisma, platform, recordFailure };
};

describe('POST /chat-integration/notification', () => {
  it('posts to the requested destinations and answers with the per-destination outcomes', async () => {
    const harness = createHarness([channelRow('C1'), channelRow('C2')]);

    const response = await harness.app.request(
      signedRequest({
        path: NOTIFICATION_PATH,
        bodyText: notificationBody(['C1', 'C2']),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcomes: [
        { platform: PLATFORM, channelId: 'C1', status: 'posted' },
        { platform: PLATFORM, channelId: 'C2', status: 'posted' },
      ],
    });
    expect(harness.platform.post).toHaveBeenCalledTimes(2);
  });

  it('accepts a body whose exact bytes no JSON.stringify would produce', async () => {
    // Whitespace and a key order no serializer emits. The guard verifies the
    // bytes as received, and this endpoint must not undo that -- an edge that
    // re-serialized the body anywhere along the way would compute a different
    // `content-digest` and refuse a legitimate GROWI.
    const harness = createHarness([channelRow('C1')]);
    const bodyText = `{ "op":"notification" ,  "relationId":"${RELATION_ID}",
      "requestId":"req-spaced", "targets":[{"channelId":"C1","platform":"slack"}],
      "markdown":"hi", "containsRestrictedPage":false }`;

    const response = await harness.app.request(
      signedRequest({ path: NOTIFICATION_PATH, bodyText }),
    );

    expect(response.status).toBe(200);
    expect(harness.platform.post).toHaveBeenCalledTimes(1);
  });

  it('does not post again to a destination an earlier attempt already reached', async () => {
    // The acceptance criterion of task 8.2, over HTTP. GROWI resends the very
    // same request; only the nonce differs, as the protocol requires.
    const harness = createHarness([
      channelRow('C-a'),
      channelRow('C-b'),
      channelRow('C-c'),
    ]);
    harness.platform.post.mockImplementation((channel) =>
      Promise.resolve(
        channel.channelId === 'C-b'
          ? { ok: false, reason: 'platform-error', detail: 'rate limited' }
          : { ok: true, messageId: `M-${channel.channelId}` },
      ),
    );
    const bodyText = notificationBody(['C-a', 'C-b', 'C-c']);

    const first = await harness.app.request(
      signedRequest({ path: NOTIFICATION_PATH, bodyText, nonce: 'nonce-1' }),
    );
    expect(first.status).toBe(200);
    expect(harness.platform.post).toHaveBeenCalledTimes(3);

    harness.platform.post.mockClear();
    harness.platform.post.mockResolvedValue({ ok: true, messageId: 'M-b' });

    const second = await harness.app.request(
      signedRequest({ path: NOTIFICATION_PATH, bodyText, nonce: 'nonce-2' }),
    );

    // Two assertions on purpose (7.3's note): "re-posted where it had already
    // succeeded" and "answered only for what it tried this time" are separate
    // faults, and one assertion lets either hide behind the other.
    expect(harness.platform.post).toHaveBeenCalledTimes(1);
    expect(harness.platform.post.mock.calls[0]?.[0].channelId).toBe('C-b');
    expect(await second.json()).toEqual({
      outcomes: [
        { platform: PLATFORM, channelId: 'C-a', status: 'posted' },
        { platform: PLATFORM, channelId: 'C-b', status: 'posted' },
        { platform: PLATFORM, channelId: 'C-c', status: 'posted' },
      ],
    });
  });

  it('refuses an unsigned request without reaching the flow at all', async () => {
    // The endpoint builds its own guard, so there is no wiring in which this
    // path is served unguarded.
    const harness = createHarness([channelRow('C1')]);

    const response = await harness.app.request(
      unsignedRequest(NOTIFICATION_PATH, notificationBody(['C1'])),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.recordFailure).toHaveBeenCalled();
  });

  it('refuses a correctly signed body of the wrong shape, and posts nothing', async () => {
    // 400 rather than 401: by this point the caller IS the relation's GROWI,
    // so naming the shape problem tells it nothing it does not know, while a
    // 401 would send an operator hunting a key that is perfectly fine.
    const harness = createHarness([channelRow('C1')]);
    const bodyText = JSON.stringify({
      relationId: RELATION_ID,
      op: OP_NAMES.notification,
      requestId: 'req-1',
      targets: [{ platform: PLATFORM }], // no channelId
      markdown: 'hi',
      containsRestrictedPage: false,
    });

    const response = await harness.app.request(
      signedRequest({ path: NOTIFICATION_PATH, bodyText }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(harness.platform.post).not.toHaveBeenCalled();
  });
});

describe('POST /chat-integration/settings-push', () => {
  it('takes a newer save and answers 204 with no body', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: SETTINGS_PUSH_PATH,
        bodyText: settingsPushBody(STORED_SETTINGS_VERSION + 1),
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(harness.prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          commandName: 'search',
          channels: ['C1'],
          allowAll: false,
        }),
      }),
    );
  });

  it('carries the wire spelling of "allow every channel" through unchanged', async () => {
    // `'all'` must not arrive at storage as an empty list -- that already
    // means its opposite (task 7.3's hand-off). The endpoint hands the parsed
    // request over as-is, so there is no second place for that to be decided.
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: SETTINGS_PUSH_PATH,
        bodyText: settingsPushBody(STORED_SETTINGS_VERSION + 1, 'all'),
      }),
    );

    expect(response.status).toBe(204);
    expect(harness.prisma.channelPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ allowAll: true, channels: [] }),
      }),
    );
  });

  it('writes nothing the second time the same save arrives', async () => {
    // The settings endpoint's own protection against being processed twice is
    // the version, not a per-request record (Requirement 10.7's per-endpoint
    // table). The second call answers 204 all the same -- GROWI's retry has
    // nothing to fix.
    const harness = createHarness();
    const bodyText = settingsPushBody(STORED_SETTINGS_VERSION + 1);

    const first = await harness.app.request(
      signedRequest({ path: SETTINGS_PUSH_PATH, bodyText, nonce: 'nonce-1' }),
    );
    expect(first.status).toBe(204);
    expect(harness.prisma.channelPermission.upsert).toHaveBeenCalledTimes(1);

    const second = await harness.app.request(
      signedRequest({ path: SETTINGS_PUSH_PATH, bodyText, nonce: 'nonce-2' }),
    );

    expect(second.status).toBe(204);
    expect(harness.prisma.channelPermission.upsert).toHaveBeenCalledTimes(1);
    expect(harness.prisma.channelPermission.deleteMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('refuses an unsigned save without touching stored settings', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      unsignedRequest(
        SETTINGS_PUSH_PATH,
        settingsPushBody(STORED_SETTINGS_VERSION + 1),
      ),
    );

    expect(response.status).toBe(401);
    expect(harness.prisma.relation.updateMany).not.toHaveBeenCalled();
    expect(harness.prisma.channelPermission.upsert).not.toHaveBeenCalled();
  });

  it('refuses a correctly signed save of the wrong shape', async () => {
    const harness = createHarness();
    const bodyText = JSON.stringify({
      relationId: RELATION_ID,
      op: OP_NAMES.settingsPush,
      version: -1, // versions count up from 0
      settings: { relationId: RELATION_ID, channelPermissions: [] },
    });

    const response = await harness.app.request(
      signedRequest({ path: SETTINGS_PUSH_PATH, bodyText }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(harness.prisma.relation.updateMany).not.toHaveBeenCalled();
  });
});
