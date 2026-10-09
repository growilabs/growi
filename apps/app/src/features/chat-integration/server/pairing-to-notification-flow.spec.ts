// Task 10.2: the whole Gen 2 lifecycle in one place -- an administrator
// pastes a registration code, the pairing round trip completes, the
// settings that administrator then saves decide what the NEXT command may
// do, a page event reaches the channel that relation was configured to post
// to, and unpairing + pairing the same workspace again keeps every user's
// account link (Requirements 2.1, 2.4, 9.1, 9.5, 9.7, 11.4).
//
// **Why this file exists next to the per-task tests.** Every stage below has
// its own unit test already (`pairing/pairing-service.spec.ts`,
// `admin/save-relation-settings.spec.ts`,
// `notification/gen2-notification-flow.spec.ts`,
// `notification/notification-dispatcher.spec.ts`), and each of those seeds
// its own `chat_relations` row by hand. What none of them can show is that
// the relation the PAIRING procedure produces is the relation all of the
// later stages actually work on: the `relationId` here is the one the proxy
// minted in `PairingResult`, the settings version starts where pairing left
// it (0, not a hand-picked number), the notification destinations are saved
// against that same relation through the real admin save path, and the
// re-pairing at the end inherits the links of the relation the first pairing
// created. A break in any of those seams passes every unit test and fails
// here.
//
// **What is faked, and only that.** The one boundary is the network: the
// four `proxy-client.ts` functions this flow calls out through
// (`submitPairing` -- injected, not module-mocked, because
// `submitPairingRequest` takes it as a parameter -- plus `pushSettings`,
// `fetchChannels` and `notify`). Everything on this side of them is the real
// implementation, including pairing step 5, which is answered by driving the
// REAL `createPairingEndpoint` handler over supertest.
//
// Gen 1's own two notification halves (mail and Slack) are replaced on the
// `GlobalNotificationService` instance: they are a different generation's
// send path, out of this spec's scope, and running them for real would try
// to send mail. Everything Gen 2 does inside `fire` stays real.

import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  verify as nodeVerify,
} from 'node:crypto';
import type {
  ChannelInventory,
  ChatAccountRef,
  CommandRequest,
  NotificationResult,
  PairingResult,
  PairingSubmission,
} from '@growi/chat';
import { pairingChallengePayload } from '@growi/chat/server';
import { PageGrant } from '@growi/core';
import type { IUser } from '@growi/core/dist/interfaces';
import express from 'express';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { mock, mockDeep } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { GlobalNotificationService } from '~/server/service/global-notification';
import type { GlobalNotificationMailService } from '~/server/service/global-notification/global-notification-mail';
import type { GlobalNotificationSlackService } from '~/server/service/global-notification/global-notification-slack';

import { ChatAccountLink } from './account-link/models/chat-account-link';
import { saveNotificationDestination } from './admin/notification-destinations';
import { saveRelationSettings } from './admin/save-relation-settings';
import { createCommandEndpoint } from './command/command-endpoint';
import { resolveActor } from './command/resolve-actor';
import type { ChatKeyEncryptionEnv } from './keys/key-encryption';
import { ChatIntegrationKey } from './keys/models/chat-integration-key';
import { ChatNotificationDestination } from './models/chat-notification-destination';
import { ChatProcessedRequest } from './models/chat-processed-request';
import { ChatRelation } from './models/chat-relation';
import { ChatNotificationOutbox } from './notification/models/chat-notification-outbox';
import { ChatNotificationDispatchCronService } from './notification/notification-dispatch-cron';
import { notificationDispatcher } from './notification/notification-dispatcher';
import { ChatChallengeAttempt } from './pairing/models/chat-challenge-attempt';
import { ChatPendingPairing } from './pairing/models/pending-pairing';
import { createPairingEndpoint } from './pairing/pairing-endpoint';
import {
  submitPairingRequest,
  unpairRelation,
} from './pairing/pairing-service';
import * as proxyClient from './proxy-client';
import { ChatChannelPermission } from './settings/models/chat-channel-permission';
import { readRelationSettings } from './settings/relation-settings-store';

vi.mock('./proxy-client', async (importOriginal) => {
  const actual = await importOriginal<typeof proxyClient>();
  return {
    ...actual,
    pushSettings: vi.fn(),
    fetchChannels: vi.fn(),
    notify: vi.fn(),
  };
});

/** A clearly-fake 32-byte value; only AES-256 has to accept it. */
const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

const PROXY_URI = 'https://proxy.example.test';
const GROWI_URI = 'https://growi.example.test';
const SITE_URL = 'https://growi.example.test';
const PLATFORM = 'slack' as const;
const WORKSPACE_ID = 'T-FLOW';
const CHALLENGE_PATH = '/peer/pairing/challenge';

/** The channel the command comes from and the settings are saved for. */
const COMMAND_CHANNEL = {
  platform: PLATFORM,
  channelId: 'C-COMMANDS',
  channelName: 'commands',
  isPrivate: false,
} as const;

/** Two notification destinations: one the proxy accepts, one it refuses. */
const CHANNEL_OK = 'C-DELIVERS';
const CHANNEL_FAILING = 'C-REFUSES';

const INVENTORY: ChannelInventory = {
  channels: [
    { ...COMMAND_CHANNEL },
    {
      platform: PLATFORM,
      channelId: CHANNEL_OK,
      channelName: 'delivers',
      isPrivate: false,
    },
    {
      platform: PLATFORM,
      channelId: CHANNEL_FAILING,
      channelName: 'refuses',
      isPrivate: false,
    },
  ],
};

const NOTIFIED_PAGE_PATH = '/flow/notified-page';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-${seq}`;
};

// biome-ignore lint/suspicious/noExplicitAny: no document type is exported for the crowi-wired User model.
const getUserModel = (): any => mongoose.model('User');

const createUser = () =>
  getUserModel().create({
    name: `flow user ${++seq}`,
    username: `flow-user-${seq}`,
    email: `flow-user-${seq}@example.com`,
    status: UserStatus.STATUS_ACTIVE,
  });

const asJwk = (key: KeyObject): JsonWebKey => {
  const jwk = key.export({ format: 'jwk' });
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
};

/**
 * Drives the REAL pairing step-5 endpoint and reports whether its answer
 * verifies against the public key GROWI declared in step 3 -- i.e. whether
 * the pending key pair really is the one it just announced.
 */
const answerOwnershipChallenge = async (
  registrationCode: string,
  submittedPublicKey: JsonWebKey,
): Promise<boolean> => {
  const app = express();
  app.use(express.raw({ type: 'application/json', limit: '1mb' }));
  app.post(CHALLENGE_PATH, createPairingEndpoint());

  const challenge = Buffer.alloc(32, 11).toString('base64url');
  const response = await request(app)
    .post(CHALLENGE_PATH)
    .set('content-type', 'application/json')
    .send(JSON.stringify({ registrationCode, challenge }));

  if (response.status !== 200) {
    return false;
  }
  return nodeVerify(
    null,
    Buffer.from(pairingChallengePayload(registrationCode, challenge), 'utf8'),
    createPublicKey({
      key: {
        kty: submittedPublicKey.kty,
        crv: submittedPublicKey.crv,
        x: submittedPublicKey.x,
      },
      format: 'jwk',
    }),
    Buffer.from(response.body.challengeSignature, 'base64url'),
  );
};

interface EstablishedPairing {
  readonly relationId: string;
  /** Whether pairing step 5 was answered with a signature that verified. */
  readonly challengeVerified: boolean;
}

/**
 * Runs one whole pairing attempt for `WORKSPACE_ID`, standing in for the
 * proxy: while GROWI awaits step 3/6, this calls back into the real
 * ownership-challenge endpoint (step 4/5) exactly as the proxy would.
 */
const establishPairing = async (): Promise<EstablishedPairing> => {
  const relationId = nextId('relation');
  const registrationCode = nextId('registration-code');
  const peer = generateKeyPairSync('ed25519');
  let challengeVerified = false;

  const outcome = await submitPairingRequest(
    {
      registrationCode,
      proxyUri: PROXY_URI,
      growiUri: GROWI_URI,
      growiLabel: 'Flow GROWI',
      createdBy: new Types.ObjectId(),
    },
    {
      submit: async (_proxyUri: string, submission: PairingSubmission) => {
        challengeVerified = await answerOwnershipChallenge(
          submission.registrationCode,
          submission.publicKey.publicKeyJwk,
        );
        const result: PairingResult = {
          status: 'paired',
          relationId,
          workspace: {
            platform: PLATFORM,
            workspaceId: WORKSPACE_ID,
            workspaceName: 'Flow Workspace',
          },
          publicKey: {
            keyId: `proxy-key-${relationId}`,
            publicKeyJwk: asJwk(peer.publicKey),
            validFrom: new Date(Date.now() - 1000).toISOString(),
          },
        };
        return { ok: true, response: result };
      },
    },
  );

  if (outcome.status !== 'paired') {
    throw new Error(
      `the flow's pairing helper expected 'paired' but got '${outcome.status}'`,
    );
  }
  return { relationId: outcome.relationId, challengeVerified };
};

const COMMANDER: ChatAccountRef = {
  platform: PLATFORM,
  accountId: 'U-COMMANDER',
  displayName: 'Commander',
};

const helpRequest = (
  relationId: string,
  channelId: string,
): CommandRequest => ({
  relationId,
  op: 'command',
  requestId: nextId('req'),
  actor: COMMANDER,
  channel: { ...COMMAND_CHANNEL, channelId },
  kind: 'help',
});

/** Runs one `help` command through the real endpoint (no Crowi work involved). */
const runHelp = (relationId: string, channelId = COMMAND_CHANNEL.channelId) =>
  createCommandEndpoint(mock<Crowi>()).handle(
    helpRequest(relationId, channelId),
  );

/**
 * Runs one `create-page` command from an UNLINKED chat account. The channel
 * gate is judged before the actor is resolved, so the response says which
 * of the two refused it: `account-link-required` means the channel gate let
 * the command through, an `error` with `no-settings` means it did not.
 */
const runCreatePageFromUnlinkedAccount = (relationId: string) =>
  createCommandEndpoint(mockDeep<Crowi>()).handle({
    relationId,
    op: 'command',
    requestId: nextId('req'),
    actor: COMMANDER,
    channel: { ...COMMAND_CHANNEL },
    kind: 'create-page',
    path: `/flow/created-${++seq}`,
    body: 'from chat',
  });

/**
 * Fires a real `pageCreate` global notification, with Gen 1's mail/Slack
 * halves replaced (see the file header) and everything Gen 2 does left real.
 */
const firePageCreate = async (): Promise<void> => {
  const service = new GlobalNotificationService(mock<Crowi>());
  service.globalNotificationMailService = mock<GlobalNotificationMailService>();
  service.globalNotificationSlackService =
    mock<GlobalNotificationSlackService>();

  await service.fire(
    'pageCreate',
    mock<PageDocument>({
      id: 'page-flow-1',
      path: NOTIFIED_PAGE_PATH,
      grant: PageGrant.GRANT_PUBLIC,
    }),
    mock<IUser>({ username: 'author' }),
  );
};

const notifyMock = vi.mocked(proxyClient.notify);

/** Every `(requestId, channelId)` the proxy was actually asked to post to. */
const postAttempts = (): ReadonlyArray<string> =>
  notifyMock.mock.calls.flatMap(([, req]) =>
    req.targets.map((target) => `${req.requestId}:${target.channelId}`),
  );

/** What `ProxyClient.notify` is handed -- the envelope fields are added by
 * `proxy-client.ts` itself, so a caller passes only these four. */
type NotifyParams = Parameters<typeof proxyClient.notify>[1];

const answerFor = (
  req: NotifyParams,
  failing: ReadonlyArray<string>,
): { ok: true; response: NotificationResult } => ({
  ok: true,
  response: {
    outcomes: req.targets.map((target) => ({
      platform: target.platform,
      channelId: target.channelId,
      status: failing.includes(target.channelId)
        ? ('platform-error' as const)
        : ('posted' as const),
    })),
  },
});

describe('Gen 2 end-to-end: pairing -> settings -> command -> notification -> re-pairing', () => {
  let mongod: MongoMemoryServer | undefined;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_pairing_to_notification_flow',
    ));
    userModelFactory(null);
    // The composite unique indexes are what the inheritance collision rule
    // and the settings write both rely on, so they must be in place.
    await Promise.all([
      ChatAccountLink.syncIndexes(),
      ChatPendingPairing.syncIndexes(),
      ChatRelation.syncIndexes(),
      ChatChannelPermission.init(),
    ]);
    // `buildNotificationContent`'s page URL comes from the configured site
    // URL; without loaded configs `getSiteUrl()` throws and the Gen 2
    // dispatch is swallowed by its own catch.
    await configManager.loadConfigs();
    await configManager.updateConfigs({ 'app:siteUrl': SITE_URL });
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
    await Promise.all([
      ChatRelation.deleteMany({}),
      ChatAccountLink.deleteMany({}),
      ChatIntegrationKey.deleteMany({}),
      ChatPendingPairing.deleteMany({}),
      ChatChallengeAttempt.deleteMany({}),
      ChatChannelPermission.deleteMany({}),
      ChatNotificationDestination.deleteMany({}),
      ChatNotificationOutbox.deleteMany({}),
      ChatProcessedRequest.deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
    vi.mocked(proxyClient.pushSettings).mockResolvedValue({
      ok: true,
      response: undefined,
    });
    vi.mocked(proxyClient.fetchChannels).mockResolvedValue({
      ok: true,
      response: INVENTORY,
    });
    notifyMock.mockImplementation(async (_relationId, req) =>
      answerFor(req, []),
    );
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  afterAll(async () => {
    await configManager.updateConfigs(
      { 'app:siteUrl': undefined },
      { removeIfUndefined: true },
    );
    await disconnectSelfContainedMongo(mongod);
  });

  describe('pairing (Requirement 9.1)', () => {
    it('completes from a pasted registration code through the ownership challenge, leaving an active relation ready to be configured', async () => {
      const { relationId, challengeVerified } = await establishPairing();

      expect(challengeVerified).toBe(true);

      const relation = await ChatRelation.findOne({ relationId }).lean();
      expect(relation).toMatchObject({
        state: 'active',
        platform: PLATFORM,
        workspaceId: WORKSPACE_ID,
        proxyUri: PROXY_URI,
        settingsVersion: 0,
      });

      // Both halves of the key pair the later stages sign with are in place,
      // and the pending row that held GROWI's own key is gone.
      const keys = await ChatIntegrationKey.find({ relationId }).lean();
      expect(keys.map((key) => key.side).sort()).toEqual(['own', 'peer']);
      expect(await ChatPendingPairing.countDocuments({})).toBe(0);
    });
  });

  describe('settings saved on the paired relation (Requirements 11.4, 9.1)', () => {
    it('pushes the version pairing left behind, and the next command is judged by what was just saved', async () => {
      const { relationId } = await establishPairing();

      // A freshly paired relation has no permission rows at all: a WRITE
      // command is refused for exactly that reason, while a read-only one
      // (`help`) is allowed -- the default the proxy and GROWI agree on.
      expect(await runCreatePageFromUnlinkedAccount(relationId)).toMatchObject({
        kind: 'error',
        code: 'no-settings',
      });
      expect((await runHelp(relationId)).kind).toBe('help');

      const saved = await saveRelationSettings(relationId, [
        { commandName: 'help', allowedChannels: [COMMAND_CHANNEL.channelId] },
      ]);

      // Pairing created the relation at version 0, so the first save is
      // version 1 -- and that is the version the proxy is told, after the
      // commit rather than before it.
      expect(saved).toEqual({
        status: 'saved',
        version: 1,
        push: { ok: true },
      });
      expect(proxyClient.pushSettings).toHaveBeenCalledWith(relationId, {
        settings: {
          relationId,
          channelPermissions: [
            {
              commandName: 'help',
              allowedChannels: [COMMAND_CHANNEL.channelId],
            },
          ],
        },
        version: 1,
      });
      expect((await readRelationSettings(relationId))?.version).toBe(1);

      // The next command execution reflects it.
      expect((await runHelp(relationId)).kind).toBe('help');

      // ...and so does the one after the setting is taken away again.
      await saveRelationSettings(relationId, [
        { commandName: 'help', allowedChannels: 'none' },
      ]);
      expect(await runHelp(relationId)).toMatchObject({
        kind: 'error',
        code: 'not-permitted-in-channel',
      });
    });
  });

  describe('notification delivery (Requirements 2.1, 2.4)', () => {
    const configureDestinations = async (relationId: string) => {
      for (const channelId of [CHANNEL_OK, CHANNEL_FAILING]) {
        // biome-ignore lint/performance/noAwaitInLoops: saved one at a time on purpose -- each save refreshes THIS relation's stored channel names, and running two of those against the same relation concurrently is a race the admin screen never creates
        const outcome = await saveNotificationDestination(relationId, {
          channelId,
          pathPattern: NOTIFIED_PAGE_PATH,
          triggerEvents: ['pageCreate'],
        });
        expect(outcome.status).toBe('saved');
      }
    };

    it('reaches every channel the relation was configured for, through the cron drain', async () => {
      const { relationId } = await establishPairing();
      await configureDestinations(relationId);

      await firePageCreate();

      // Written down first, delivered later (Requirement 2.5's two stages).
      const enqueued = await ChatNotificationOutbox.find({ relationId }).lean();
      expect(enqueued).toHaveLength(2);
      expect(enqueued.every((row) => row.state === 'pending')).toBe(true);
      expect(
        enqueued.flatMap((row) => row.targets.map((t) => t.channelId)).sort(),
      ).toEqual([CHANNEL_FAILING, CHANNEL_OK].sort());
      expect(enqueued[0].markdown).toContain(NOTIFIED_PAGE_PATH);

      // The real cron job is what turns the outbox into posts.
      await new ChatNotificationDispatchCronService().executeJob();

      expect(
        postAttempts()
          .map((attempt) => attempt.split(':')[1])
          .sort(),
      ).toEqual([CHANNEL_FAILING, CHANNEL_OK].sort());
      const delivered = await ChatNotificationOutbox.find({
        relationId,
      }).lean();
      expect(delivered.every((row) => row.state === 'sent')).toBe(true);
    });

    it('re-posts only the destination that failed, never the one that already got it (Requirement 2.4, 10.4)', async () => {
      const { relationId } = await establishPairing();
      await configureDestinations(relationId);
      notifyMock.mockImplementation(async (_relationId, req) =>
        answerFor(req, [CHANNEL_FAILING]),
      );

      await firePageCreate();
      await new ChatNotificationDispatchCronService().executeJob();

      const afterFirstRound = await ChatNotificationOutbox.find({
        relationId,
      }).lean();
      const sent = afterFirstRound.filter((row) => row.state === 'sent');
      const retrying = afterFirstRound.filter((row) => row.state === 'pending');
      expect(sent.map((row) => row.targets[0].channelId)).toEqual([CHANNEL_OK]);
      expect(retrying.map((row) => row.targets[0].channelId)).toEqual([
        CHANNEL_FAILING,
      ]);
      expect(retrying[0].attempts).toBe(1);

      // Retry once the backoff has elapsed, this time with the proxy
      // accepting everything.
      notifyMock.mockImplementation(async (_relationId, req) =>
        answerFor(req, []),
      );
      const laterThanAnyBackoff = new Date(Date.now() + 60 * 60 * 1000);
      await notificationDispatcher.drain(laterThanAnyBackoff);

      // The whole point: the channel that already received the notification
      // was asked exactly once, and the failed one carries the SAME
      // requestId into its retry (the id the proxy dedupes on).
      const attempts = postAttempts();
      const okAttempts = attempts.filter((a) => a.endsWith(`:${CHANNEL_OK}`));
      const failingAttempts = attempts.filter((a) =>
        a.endsWith(`:${CHANNEL_FAILING}`),
      );
      expect(okAttempts).toHaveLength(1);
      expect(failingAttempts).toHaveLength(2);
      expect(failingAttempts[0]).toBe(failingAttempts[1]);

      const settled = await ChatNotificationOutbox.find({ relationId }).lean();
      expect(settled.every((row) => row.state === 'sent')).toBe(true);
    });
  });

  describe('unpairing and pairing again (Requirements 9.5, 9.7)', () => {
    const linkedActor = (accountId: string): ChatAccountRef => ({
      platform: PLATFORM,
      accountId,
      displayName: `Person ${accountId}`,
    });

    it('carries the account links onto the re-paired relation, so the same chat account still resolves to its GROWI user', async () => {
      const first = await establishPairing();
      const alice = await createUser();
      const bob = await createUser();
      await ChatAccountLink.create([
        {
          relationId: first.relationId,
          userId: alice._id,
          platform: PLATFORM,
          accountId: 'U-ALICE',
          linkedAt: new Date(),
        },
        {
          relationId: first.relationId,
          userId: bob._id,
          platform: PLATFORM,
          accountId: 'U-BOB',
          linkedAt: new Date(),
        },
      ]);

      expect(await unpairRelation(first.relationId)).toBe('unpaired');

      const second = await establishPairing();
      expect(second.relationId).not.toBe(first.relationId);

      // Contract-level check: the chat accounts still resolve, now under the
      // new relation -- not just "some rows moved".
      const resolvedAlice = await resolveActor(
        second.relationId,
        linkedActor('U-ALICE'),
      );
      const resolvedBob = await resolveActor(
        second.relationId,
        linkedActor('U-BOB'),
      );
      expect(resolvedAlice.user?._id.toString()).toBe(alice._id.toString());
      expect(resolvedBob.user?._id.toString()).toBe(bob._id.toString());
      expect(
        await ChatAccountLink.countDocuments({ relationId: first.relationId }),
      ).toBe(0);
    });

    it('stops posting to the unpaired relation: its destinations are gone and a later page event enqueues nothing', async () => {
      const { relationId } = await establishPairing();
      expect(
        (
          await saveNotificationDestination(relationId, {
            channelId: CHANNEL_OK,
            pathPattern: NOTIFIED_PAGE_PATH,
            triggerEvents: ['pageCreate'],
          })
        ).status,
      ).toBe('saved');
      await saveRelationSettings(relationId, [
        { commandName: 'create-page', allowedChannels: 'all' },
      ]);
      // The channel gate is open at this point: the write command gets past
      // it and is refused for a different reason (this chat account has no
      // GROWI user linked to it yet).
      expect((await runCreatePageFromUnlinkedAccount(relationId)).kind).toBe(
        'account-link-required',
      );

      await unpairRelation(relationId);

      await firePageCreate();

      expect(await ChatNotificationOutbox.countDocuments({})).toBe(0);
      expect(await ChatIntegrationKey.countDocuments({ relationId })).toBe(0);
      expect(await ChatNotificationDestination.countDocuments({})).toBe(0);
      // The saved permission is gone with the relation, so the same write
      // command is refused at the channel gate again -- and a new save
      // cannot bring it back.
      expect(await runCreatePageFromUnlinkedAccount(relationId)).toMatchObject({
        kind: 'error',
        code: 'no-settings',
      });
      expect(
        await saveRelationSettings(relationId, [
          { commandName: 'create-page', allowedChannels: 'all' },
        ]),
      ).toEqual({ status: 'relation-not-found' });
    });
  });
});
