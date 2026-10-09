// The three endpoints a GROWI reads from (design.md's 「GROWI から届く口」 rows
// `capabilities`, `connection-status` and `channels`; Requirements 1.3, 1.4,
// 2.2, 11.1).
//
// **The property this file exists for is the 「返す範囲」 column.** design.md
// says the default implementation falls to "return everything" because that is
// the shortest thing to write, and that an official proxy carries many GROWIs
// -- so every scoped endpoint is exercised with a SECOND installation present
// in the same store, and asserted to answer nothing about it. A test with one
// installation cannot tell a scoped answer from an unscoped one.
//
// Real Hono, real Ed25519 signatures, real repositories over a doubled
// PostgreSQL client, as `notification-routes.spec.ts` established. The
// connection manager is a stub because what it reports is exactly the input
// this task's mapping is defined over.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { PlatformName } from '@growi/chat';
import { OP_NAMES } from '@growi/chat';
import type { KeyRef, VerifyFailure } from '@growi/chat/server';
import { sign } from '@growi/chat/server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { CONNECTION_UNIT_TABLE } from '../capabilities/index.js';
import {
  createInstallationChannelRepository,
  createInstallationRepository,
  createRelationRepository,
  type PrismaClient,
} from '../db/index.js';
import type { ConnectionStatusRow } from '../platform/index.js';
import type { SecretCipher } from '../types/index.js';
import { type ReadRoutesDeps, registerReadRoutes } from './read-routes.js';
import type { SignedRequestEnv } from './signature-guard.js';

const CAPABILITIES_PATH = '/chat-integration/capabilities';
const CONNECTION_STATUS_PATH = '/chat-integration/connection-status';
const CHANNELS_PATH = '/chat-integration/channels';
const CONTENT_TYPE = 'application/json';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const SINCE = new Date('2026-05-31T00:00:00.000Z');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => plaintext,
  decrypt: (ciphertext) => ciphertext,
};

// ---------------------------------------------------------------------------
// Two tenants on one proxy: relation A on installation A, relation B on
// installation B. Every scoped assertion below is about B being invisible to
// A even though both are in the same store.
// ---------------------------------------------------------------------------

interface RelationFixture {
  readonly relationId: string;
  readonly installationId: string;
  readonly platform: PlatformName;
}

const RELATION_A: RelationFixture = {
  relationId: 'relation-a',
  installationId: 'installation-a',
  platform: 'mattermost',
};
const RELATION_B: RelationFixture = {
  relationId: 'relation-b',
  installationId: 'installation-b',
  platform: 'mattermost',
};
/** A service whose one connection serves every installation of the app. */
const RELATION_SLACK: RelationFixture = {
  relationId: 'relation-slack',
  installationId: 'installation-slack',
  platform: 'slack',
};
/** A service that dials this proxy instead of the other way round. */
const RELATION_TEAMS: RelationFixture = {
  relationId: 'relation-teams',
  installationId: 'installation-teams',
  platform: 'teams',
};

const ALL_RELATIONS = [
  RELATION_A,
  RELATION_B,
  RELATION_SLACK,
  RELATION_TEAMS,
] as const;

const channelRow = (row: {
  readonly installationId: string;
  readonly platform: PlatformName;
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate?: boolean;
}) => ({
  installationId: row.installationId,
  platform: row.platform,
  channelId: row.channelId,
  channelName: row.channelName,
  isPrivate: row.isPrivate ?? false,
  refreshedAt: SINCE,
});

const CHANNEL_ROWS = [
  channelRow({
    installationId: 'installation-a',
    platform: 'mattermost',
    channelId: 'C-a1',
    channelName: 'a-general',
  }),
  channelRow({
    installationId: 'installation-a',
    platform: 'mattermost',
    channelId: 'C-a2',
    channelName: 'a-secret',
    isPrivate: true,
  }),
  channelRow({
    installationId: 'installation-b',
    platform: 'mattermost',
    channelId: 'C-b1',
    channelName: 'b-general',
  }),
  channelRow({
    installationId: 'installation-slack',
    platform: 'slack',
    channelId: 'C-s1',
    channelName: 's-general',
  }),
];

const createPrisma = (): DeepMockProxy<PrismaClient> => {
  const prisma = mockDeep<PrismaClient>();

  prisma.relation.findUnique.mockImplementation(((args: {
    where: { id: string };
  }) => {
    const fixture = ALL_RELATIONS.find(
      (candidate) => candidate.relationId === args.where.id,
    );
    return Promise.resolve(
      fixture == null
        ? null
        : {
            id: fixture.relationId,
            installationId: fixture.installationId,
            growiUri: `https://${fixture.relationId}.example.com/`,
            growiLabel: fixture.relationId,
            searchWeight: 1,
            settingsVersion: 1,
            createdAt: SINCE,
          },
    );
  }) as never);

  prisma.installation.findUnique.mockImplementation(((args: {
    where: { id: string };
  }) => {
    const fixture = ALL_RELATIONS.find(
      (candidate) => candidate.installationId === args.where.id,
    );
    return Promise.resolve(
      fixture == null
        ? null
        : {
            id: fixture.installationId,
            platform: fixture.platform,
            workspaceId: `W-${fixture.installationId}`,
            workspaceName: fixture.installationId,
            credentials: 'cipher',
            createdAt: SINCE,
            channelsSyncedAt: SINCE,
          },
    );
  }) as never);

  prisma.installationChannel.findMany.mockImplementation(((args: {
    where: { installationId: string };
  }) =>
    Promise.resolve(
      CHANNEL_ROWS.filter(
        (row) => row.installationId === args.where.installationId,
      ),
    )) as never);

  return prisma;
};

// ---------------------------------------------------------------------------

const signedRequest = (options: {
  readonly path: string;
  readonly op: string;
  readonly relationId: string;
  readonly keyId?: string;
  readonly bodyText?: string;
}): Request => {
  const bodyText =
    options.bodyText ??
    JSON.stringify({ relationId: options.relationId, op: options.op });
  const bytes = new TextEncoder().encode(bodyText);
  const key: KeyRef = {
    relationId: options.relationId,
    keyId: options.keyId ?? 'key-1',
  };
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
    key,
    privateKey,
    expiresInSec: 60,
  });
  return new Request(`http://proxy.example${options.path}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
    body: bytes,
  });
};

interface Harness {
  readonly app: Hono<SignedRequestEnv>;
  readonly prisma: DeepMockProxy<PrismaClient>;
  readonly recordFailure: ReturnType<
    typeof vi.fn<(failure: VerifyFailure, ctx: unknown) => Promise<void>>
  >;
}

const createHarness = (
  connectionRows: ReadonlyArray<ConnectionStatusRow> = [],
): Harness => {
  const prisma = createPrisma();
  const recordFailure = vi.fn<
    (failure: VerifyFailure, ctx: unknown) => Promise<void>
  >(async () => undefined);

  const deps: ReadRoutesDeps = {
    signature: {
      resolvePublicKey: (): Promise<KeyObject | null> =>
        Promise.resolve(publicKey),
      consumeNonce: () => Promise.resolve(true),
      recordFailure,
    },
    relations: createRelationRepository(prisma),
    installations: createInstallationRepository(prisma, fakeCipher),
    channels: createInstallationChannelRepository(prisma),
    connections: { status: () => Promise.resolve(connectionRows) },
    units: CONNECTION_UNIT_TABLE,
    now: () => NOW,
  };

  const app = new Hono<SignedRequestEnv>();
  registerReadRoutes(app, deps);

  return { app, prisma, recordFailure };
};

describe('POST /chat-integration/capabilities', () => {
  it('answers the whole capability table, with a substitute only where the level is not full', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: CAPABILITIES_PATH,
        op: OP_NAMES.capabilities,
        relationId: RELATION_A.relationId,
      }),
    );

    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      platforms: ReadonlyArray<{
        platform: string;
        capabilities: ReadonlyArray<{
          capability: string;
          level: string;
          substitute: string | null;
        }>;
      }>;
    };

    const rowOf = (platform: string, capability: string) =>
      report.platforms
        .find((entry) => entry.platform === platform)
        ?.capabilities.find((entry) => entry.capability === capability);

    // design.md's 能力表, spot-checked at the three shapes a row can take.
    expect(rowOf('slack', 'card')).toEqual({
      capability: 'card',
      level: 'full',
      substitute: null,
    });
    expect(rowOf('mattermost', 'card')?.level).toBe('degraded');
    expect(rowOf('mattermost', 'card')?.substitute).toEqual(expect.any(String));
    expect(rowOf('discord', 'linkPreview')?.level).toBe('none');
    expect(rowOf('discord', 'linkPreview')?.substitute).toEqual(
      expect.any(String),
    );
  });

  it('answers the same report whichever relation signs the request (it is proxy-wide, not scoped)', async () => {
    // The one endpoint of the three with no 「返す範囲」 to keep: the table is
    // static and identical for every workspace, so an answer that varied by
    // caller would mean something is being read that should not be.
    const harness = createHarness();

    const forA = await harness.app.request(
      signedRequest({
        path: CAPABILITIES_PATH,
        op: OP_NAMES.capabilities,
        relationId: RELATION_A.relationId,
      }),
    );
    const forB = await harness.app.request(
      signedRequest({
        path: CAPABILITIES_PATH,
        op: OP_NAMES.capabilities,
        relationId: RELATION_B.relationId,
      }),
    );

    expect(await forA.json()).toStrictEqual(await forB.json());
  });

  it('refuses an unsigned request', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      new Request(`http://proxy.example${CAPABILITIES_PATH}`, {
        method: 'POST',
        headers: { 'content-type': CONTENT_TYPE },
        body: JSON.stringify({
          relationId: RELATION_A.relationId,
          op: OP_NAMES.capabilities,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(harness.recordFailure).toHaveBeenCalled();
  });
});

describe('POST /chat-integration/connection-status', () => {
  it("answers only for the connection serving the caller's own installation", async () => {
    // Both installations are Mattermost, which is served per installation, so
    // an answer that folded every row of the service together would report
    // the OTHER tenant's failure to this one.
    const harness = createHarness([
      {
        lockKey: 'installation:installation-a',
        platform: 'mattermost',
        state: 'connected',
        since: SINCE,
        servedInstallationIds: ['installation-a'],
      },
      {
        lockKey: 'installation:installation-b',
        platform: 'mattermost',
        state: 'failed',
        since: SINCE,
        servedInstallationIds: ['installation-b'],
      },
    ]);

    const response = await harness.app.request(
      signedRequest({
        path: CONNECTION_STATUS_PATH,
        op: OP_NAMES.connectionStatus,
        relationId: RELATION_A.relationId,
      }),
    );

    expect(response.status).toBe(200);
    // Whole-body assertion on purpose: returning the internal
    // `ConnectionStatusRow` instead of the view is the actual failure mode,
    // and that row carries `servedInstallationIds` -- every other tenant's id.
    expect(await response.json()).toStrictEqual({
      platform: 'mattermost',
      health: 'connected',
      since: SINCE.toISOString(),
    });
  });

  it('reports a connection another instance holds as connected, never as broken', async () => {
    // design.md's mapping table: `held-by-other` is a HEALTHY state. Reporting
    // it as disconnected would make a three-instance deployment look broken
    // from two instances out of three.
    const harness = createHarness([
      {
        lockKey: 'app:slack',
        platform: 'slack',
        state: 'held-by-other',
        since: SINCE,
        servedInstallationIds: ['installation-slack', 'installation-other'],
      },
    ]);

    const response = await harness.app.request(
      signedRequest({
        path: CONNECTION_STATUS_PATH,
        op: OP_NAMES.connectionStatus,
        relationId: RELATION_SLACK.relationId,
      }),
    );

    expect(await response.json()).toStrictEqual({
      platform: 'slack',
      health: 'connected',
      since: SINCE.toISOString(),
    });
  });

  it('reports a failed connection as failed (Requirement 1.4)', async () => {
    const harness = createHarness([
      {
        lockKey: 'installation:installation-a',
        platform: 'mattermost',
        state: 'failed',
        since: SINCE,
        servedInstallationIds: ['installation-a'],
      },
    ]);

    const response = await harness.app.request(
      signedRequest({
        path: CONNECTION_STATUS_PATH,
        op: OP_NAMES.connectionStatus,
        relationId: RELATION_A.relationId,
      }),
    );

    expect(await response.json()).toStrictEqual({
      platform: 'mattermost',
      health: 'failed',
      since: SINCE.toISOString(),
    });
  });

  it('answers not-applicable for a service that holds no connection at all', async () => {
    const harness = createHarness([]);

    const response = await harness.app.request(
      signedRequest({
        path: CONNECTION_STATUS_PATH,
        op: OP_NAMES.connectionStatus,
        relationId: RELATION_TEAMS.relationId,
      }),
    );

    expect(await response.json()).toStrictEqual({
      platform: 'teams',
      health: 'not-applicable',
      since: NOW.toISOString(),
    });
  });

  it('answers reconnecting for a connection-bearing service with nothing reported yet', async () => {
    // Before the first reconciliation there is no row to map. `failed` would
    // page an operator over a proxy that has simply not started reconciling,
    // and `not-applicable` would claim Mattermost needs no connection.
    const harness = createHarness([]);

    const response = await harness.app.request(
      signedRequest({
        path: CONNECTION_STATUS_PATH,
        op: OP_NAMES.connectionStatus,
        relationId: RELATION_A.relationId,
      }),
    );

    expect(await response.json()).toStrictEqual({
      platform: 'mattermost',
      health: 'reconnecting',
      since: NOW.toISOString(),
    });
  });

  it('refuses an unsigned request', async () => {
    const harness = createHarness([]);

    const response = await harness.app.request(
      new Request(`http://proxy.example${CONNECTION_STATUS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': CONTENT_TYPE },
        body: JSON.stringify({
          relationId: RELATION_A.relationId,
          op: OP_NAMES.connectionStatus,
        }),
      }),
    );

    expect(response.status).toBe(401);
  });
});

describe('POST /chat-integration/channels', () => {
  it("answers the saved inventory of the caller's own installation only", async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: CHANNELS_PATH,
        op: OP_NAMES.channels,
        relationId: RELATION_A.relationId,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      channels: [
        {
          platform: 'mattermost',
          channelId: 'C-a1',
          channelName: 'a-general',
          isPrivate: false,
        },
        {
          platform: 'mattermost',
          channelId: 'C-a2',
          channelName: 'a-secret',
          isPrivate: true,
        },
      ],
    });
  });

  it('never names a channel of another installation, and reads by installation id', async () => {
    // The second half matters as much as the first: a read that fetched every
    // row and filtered afterwards would pass the assertion above while still
    // carrying every tenant's inventory through this process.
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: CHANNELS_PATH,
        op: OP_NAMES.channels,
        relationId: RELATION_B.relationId,
      }),
    );

    const body = (await response.json()) as {
      channels: ReadonlyArray<{ channelId: string }>;
    };
    expect(body.channels.map((channel) => channel.channelId)).toEqual(['C-b1']);
    expect(harness.prisma.installationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { installationId: 'installation-b' },
      }),
    );
  });

  it('answers an empty inventory rather than everything when nothing is saved', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: CHANNELS_PATH,
        op: OP_NAMES.channels,
        relationId: RELATION_TEAMS.relationId,
      }),
    );

    expect(await response.json()).toStrictEqual({ channels: [] });
  });

  it('refuses an unsigned request without reading any inventory', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      new Request(`http://proxy.example${CHANNELS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': CONTENT_TYPE },
        body: JSON.stringify({
          relationId: RELATION_A.relationId,
          op: OP_NAMES.channels,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(harness.prisma.installationChannel.findMany).not.toHaveBeenCalled();
  });

  it('refuses a correctly signed body of the wrong shape with an empty 400', async () => {
    // A relation id longer than the protocol allows: the guard lets it past
    // (it only reads the two envelope fields as strings, and the signature is
    // over this very relation), and `parseOpEnvelope` is what refuses it. 400
    // rather than 401 -- the caller is the relation's own GROWI by this point,
    // so a shape problem tells it nothing it does not already know.
    const overlongRelationId = 'r'.repeat(200);
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: CHANNELS_PATH,
        op: OP_NAMES.channels,
        relationId: overlongRelationId,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(harness.prisma.installationChannel.findMany).not.toHaveBeenCalled();
  });
});
