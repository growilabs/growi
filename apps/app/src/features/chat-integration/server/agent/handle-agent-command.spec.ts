// Accepting an `agent` request (design.md HandleAgentCommand): the gates run in
// the order channel permission -> account link -> AI availability -> insertion
// of the running row, `accepted` is answered without waiting for the run, and a
// re-sent request (same relationId + requestId) is accepted again but run once.
// Exercised through the command endpoint, which is how the proxy reaches it.

import {
  type ChannelRef,
  type ChatAccountRef,
  type CommandRequest,
  toNativeChannelId,
} from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import type { Mock } from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type Crowi from '~/server/crowi';
import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatAccountLinkOrder } from '../account-link/models/chat-account-link-order';
import { createCommandEndpoint } from '../command/command-endpoint';
import { resolveActor } from '../command/resolve-actor';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { createChatOutbox } from '../outbox/chat-outbox';
import { outboxDispatcher } from '../outbox/deliverers';
import { ChatOutboxRow } from '../outbox/models/chat-outbox';
import type { OutboxDispatcher } from '../outbox/outbox-dispatcher';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import type { GrowiAiGateway } from './growi-ai-gateway-types';
import type { AgentRequestRunner } from './handle-agent-command';
import { ChatAgentRequest } from './models/chat-agent-request';
import { createAgentRequestRunner } from './run-agent-request';

const RELATION_ID = 'relation-agent';
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: toNativeChannelId('C0AGENT'),
  channelName: 'agent-channel',
  isPrivate: false,
};
const OTHER_CHANNEL_ID = toNativeChannelId('C0ELSEWHERE');

let seq = 0;
const nextActor = (): ChatAccountRef => {
  seq += 1;
  return {
    platform: 'slack',
    accountId: `U0AGENT-${seq}`,
    displayName: `Asker ${seq}`,
  };
};

const agentRequest = (
  actor: ChatAccountRef,
  requestId = `req-agent-${++seq}`,
): CommandRequest => ({
  relationId: RELATION_ID,
  op: 'command',
  requestId,
  actor,
  channel: CHANNEL,
  kind: 'agent',
  text: 'what changed in the release notes?',
  conversationKey: `slack:${CHANNEL.channelId}:1700000000.000100`,
});

const buildCrowi = (overrides: { aiReady: boolean }): Crowi =>
  mock<Crowi>({
    isAiReady: vi.fn(() => overrides.aiReady),
    appService: { getAppTitle: vi.fn(() => 'Test GROWI') },
  });

// The run starts after the response has gone out, i.e. on a later turn of
// the event loop than the one `handle` resolves on.
const afterResponseIsSent = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const neverSettles = (): Promise<void> => new Promise(() => {});

const fakeRunner = (
  impl: AgentRequestRunner = async () => {},
): Mock<AgentRequestRunner> => vi.fn<AgentRequestRunner>(impl);

// biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
const getUserModel = (): any => mongoose.model('User');

const createLinkedUser = async (
  actor: ChatAccountRef,
  overrides: { readOnly?: boolean } = {},
) => {
  seq += 1;
  const user = await getUserModel().create({
    name: `asker ${seq}`,
    username: `asker-${seq}`,
    email: `asker-${seq}@example.com`,
    status: UserStatus.STATUS_ACTIVE,
    readOnly: overrides.readOnly ?? false,
  });
  await ChatAccountLink.create({
    relationId: RELATION_ID,
    userId: user._id,
    platform: actor.platform,
    accountId: actor.accountId,
    linkedAt: new Date(),
  });
  return user;
};

const allowAgentIn = (allowedChannels: string[]) =>
  ChatChannelPermission.create({
    relationId: RELATION_ID,
    commandName: 'agent',
    allowedChannels,
  });

describe('accepting an agent request', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_handle_agent_command',
    ));
    userModelFactory(null);
    // The account-link URL in `account-link-required` reads the site URL.
    await configManager.loadConfigs();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      ChatAccountLinkOrder.deleteMany({}),
      ChatChannelPermission.deleteMany({}),
      ChatProcessedRequest.deleteMany({}),
      ChatAgentRequest.deleteMany({}),
      ChatOutboxRow.deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
    // The indexes of chat_agent_requests come from the migration alone.
    await ChatAgentRequest.collection.dropIndexes().catch(() => undefined);
    const migration = await import(
      '~/migrations/20261116140000-add-chat-agent-request-indexes'
    );
    await migration.up(mongoose.connection.db);
    await allowAgentIn([CHANNEL.channelId]);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('when every gate passes', () => {
    it('answers accepted and runs the stored request once, after the response', async () => {
      const actor = nextActor();
      const user = await createLinkedUser(actor);
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const request = agentRequest(actor);

      const response = await endpoint.handle(request);

      expect(response).toEqual({ kind: 'accepted' });
      expect(runAgentRequest).not.toHaveBeenCalled();

      await afterResponseIsSent();

      expect(runAgentRequest).toHaveBeenCalledTimes(1);
      const [row] = runAgentRequest.mock.calls[0];
      expect(row).toMatchObject({
        relationId: RELATION_ID,
        requestId: request.requestId,
        state: 'running',
        text: 'what changed in the release notes?',
        conversationKey: `slack:${CHANNEL.channelId}:1700000000.000100`,
        actor,
        channel: CHANNEL,
      });
      expect(row.userId.toString()).toBe(user._id.toString());
      // The page the run may create later is audited with the channel the
      // request came from, like the other writing commands.
      expect(row.auditContext.endpoint).toContain(CHANNEL.channelId);
    });

    it('does not wait for the run before answering', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest: fakeRunner(neverSettles),
      });

      const outcome = await Promise.race([
        endpoint.handle(agentRequest(actor)),
        new Promise((resolve) =>
          setTimeout(() => resolve('still-waiting'), 1000),
        ),
      ]);

      expect(outcome).toEqual({ kind: 'accepted' });
    });

    it.each([
      [
        'rejects',
        () => fakeRunner(async () => Promise.reject(new Error('run failed'))),
      ],
      [
        'throws synchronously',
        () =>
          fakeRunner((): Promise<void> => {
            throw new Error('run failed');
          }),
      ],
    ])('keeps answering accepted when the run %s', async (_label, makeRunner) => {
      const runAgentRequest = makeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const first = nextActor();
      const second = nextActor();
      await createLinkedUser(first);
      await createLinkedUser(second);

      expect(await endpoint.handle(agentRequest(first))).toEqual({
        kind: 'accepted',
      });
      await afterResponseIsSent();
      expect(await endpoint.handle(agentRequest(second))).toEqual({
        kind: 'accepted',
      });
      await afterResponseIsSent();

      expect(runAgentRequest).toHaveBeenCalledTimes(2);
    });

    it('does not store the response for replay, so a refusal is not repeated for a day', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const request = agentRequest(actor);

      const refused = await createCommandEndpoint(
        buildCrowi({ aiReady: false }),
        { runAgentRequest: fakeRunner() },
      ).handle(request);
      const accepted = await createCommandEndpoint(
        buildCrowi({ aiReady: true }),
        { runAgentRequest: fakeRunner() },
      ).handle(request);

      expect(refused).toMatchObject({ kind: 'error', code: 'ai-unavailable' });
      expect(accepted).toEqual({ kind: 'accepted' });
      expect(await ChatProcessedRequest.countDocuments({})).toBe(0);
    });
  });

  describe('refusals (each with every other gate passing)', () => {
    it('refuses a channel the agent command is not allowed in (Requirement 11.6)', async () => {
      await ChatChannelPermission.deleteMany({});
      await allowAgentIn([OTHER_CHANNEL_ID]);
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });

      const response = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();

      expect(response).toMatchObject({
        kind: 'error',
        code: 'not-permitted-in-channel',
      });
      expect(runAgentRequest).not.toHaveBeenCalled();
      expect(await ChatAgentRequest.countDocuments({})).toBe(0);
    });

    it('stays refused on a connection whose administrator has not allowed it yet (Requirement 11.6)', async () => {
      await ChatChannelPermission.deleteMany({});
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });

      const response = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();

      expect(response).toMatchObject({ kind: 'error', code: 'no-settings' });
      expect(runAgentRequest).not.toHaveBeenCalled();
      expect(await ChatAgentRequest.countDocuments({})).toBe(0);
    });

    it('asks an unlinked person to link their account (Requirement 15.3)', async () => {
      const actor = nextActor();
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });

      const response = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();

      expect(response).toMatchObject({
        kind: 'account-link-required',
        growiLabel: 'Test GROWI',
      });
      expect(runAgentRequest).not.toHaveBeenCalled();
      expect(await ChatAgentRequest.countDocuments({})).toBe(0);
    });

    it('refuses a read-only user, since the request may create a page', async () => {
      const actor = nextActor();
      await createLinkedUser(actor, { readOnly: true });
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });

      const response = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();

      expect(response).toMatchObject({ kind: 'error', code: 'forbidden' });
      expect(runAgentRequest).not.toHaveBeenCalled();
      expect(await ChatAgentRequest.countDocuments({})).toBe(0);
    });

    it('refuses with ai-unavailable when GROWI AI cannot be used (Requirement 15.4)', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: false }), {
        runAgentRequest,
      });

      const response = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();

      expect(response).toMatchObject({ kind: 'error', code: 'ai-unavailable' });
      expect(runAgentRequest).not.toHaveBeenCalled();
      expect(await ChatAgentRequest.countDocuments({})).toBe(0);
    });

    it('refuses a second request of the same person while the first is running (Requirement 15.12)', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner(neverSettles);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });

      const first = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();
      const second = await endpoint.handle(agentRequest(actor));
      await afterResponseIsSent();

      expect(first).toEqual({ kind: 'accepted' });
      expect(second).toMatchObject({ kind: 'error', code: 'busy' });
      expect(runAgentRequest).toHaveBeenCalledTimes(1);
    });

    it('accepts the next request once the previous one has finished', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });

      await endpoint.handle(agentRequest(actor));
      await ChatAgentRequest.updateMany({}, { state: 'done' });
      const next = await endpoint.handle(agentRequest(actor));

      expect(next).toEqual({ kind: 'accepted' });
    });
  });

  // Readiness is "turned on AND a model is configured"; the person is told
  // which of the two is missing.
  describe('the reason given when GROWI AI is unavailable (Requirement 15.4)', () => {
    afterEach(async () => {
      await configManager.updateConfigs(
        { 'app:aiEnabled': undefined },
        { removeIfUndefined: true, skipPubsub: true },
      );
    });

    const refusalMessage = async (): Promise<string> => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: false }), {
        runAgentRequest: fakeRunner(),
      });
      const response = await endpoint.handle(agentRequest(actor));
      expect(response).toMatchObject({ kind: 'error', code: 'ai-unavailable' });
      return response.kind === 'error' ? response.message : '';
    };

    it('says GROWI AI is turned off when an administrator has not enabled it', async () => {
      await configManager.updateConfigs(
        { 'app:aiEnabled': false },
        { skipPubsub: true },
      );

      expect(await refusalMessage()).toMatch(/not enabled/i);
    });

    it('says no AI model is configured when GROWI AI is enabled but has no usable model', async () => {
      await configManager.updateConfigs(
        { 'app:aiEnabled': true },
        { skipPubsub: true },
      );

      const message = await refusalMessage();

      expect(message).toMatch(/no AI model/i);
      expect(message).not.toMatch(/not enabled/i);
    });
  });

  describe('gate order', () => {
    it('judges the channel permission before the account link', async () => {
      await ChatChannelPermission.deleteMany({});
      await allowAgentIn([OTHER_CHANNEL_ID]);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest: fakeRunner(),
      });

      const response = await endpoint.handle(agentRequest(nextActor()));

      expect(response).toMatchObject({
        kind: 'error',
        code: 'not-permitted-in-channel',
      });
      expect(await ChatAccountLinkOrder.countDocuments({})).toBe(0);
    });

    it('asks for the account link before reporting that AI is unavailable', async () => {
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: false }), {
        runAgentRequest: fakeRunner(),
      });

      const response = await endpoint.handle(agentRequest(nextActor()));

      expect(response.kind).toBe('account-link-required');
    });

    it('reports AI unavailable rather than busy while a previous request is running', async () => {
      const actor = nextActor();
      const user = await createLinkedUser(actor);
      await ChatAgentRequest.create({
        relationId: RELATION_ID,
        requestId: 'req-still-running',
        userId: user._id,
        text: 'earlier question',
        conversationKey: 'slack:C0AGENT:1',
        actor,
        channel: CHANNEL,
        auditContext: { requestArrivedAt: new Date() },
      });
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: false }), {
        runAgentRequest: fakeRunner(),
      });

      const response = await endpoint.handle(agentRequest(actor));

      expect(response).toMatchObject({ kind: 'error', code: 'ai-unavailable' });
    });
  });

  describe('with the real runner', () => {
    const answerRowsOf = (requestId: string) =>
      ChatOutboxRow.find({ kind: 'command-answer', requestId }).lean();

    const untilFinished = () =>
      vi.waitFor(async () => {
        expect(
          await ChatAgentRequest.countDocuments({ state: 'running' }),
        ).toBe(0);
      });

    it('answers the accepted request and frees the person for the next one (fake AI)', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const gateway = mock<GrowiAiGateway>();
      gateway.classify.mockResolvedValue({
        kind: 'completed',
        value: { intent: 'answer' },
      });
      gateway.answer.mockResolvedValue({
        kind: 'completed',
        value: { markdown: 'The release notes added X.', sources: [] },
      });
      const runAgentRequest = createAgentRequestRunner({
        gateway,
        fetchConversation: vi.fn(),
        outbox: createChatOutbox({
          dispatcher: mock<OutboxDispatcher>({
            requestDrain: vi.fn(async () => {}),
          }),
        }),
        requests: ChatAgentRequest,
        resolveActor,
        isAiReady: () => true,
        createSummaryPage: vi.fn(),
        siteUrl: () => 'https://wiki.example.test',
        now: () => new Date(),
      });
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const request = agentRequest(actor);

      const first = await endpoint.handle(request);
      await untilFinished();
      const next = await endpoint.handle(agentRequest(actor));

      expect(first).toEqual({ kind: 'accepted' });
      expect(await answerRowsOf(request.requestId)).toMatchObject([
        {
          relationId: RELATION_ID,
          answer: {
            kind: 'text',
            markdown: 'The release notes added X.',
            sources: [],
          },
        },
      ]);
      expect(next).toEqual({ kind: 'accepted' });
    });

    it('is what production uses: AI turned off after acceptance still gets an answer', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const crowi = mock<Crowi>({
        isAiReady: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
        appService: { getAppTitle: vi.fn(() => 'Test GROWI') },
      });
      const request = agentRequest(actor);

      const response = await createCommandEndpoint(crowi).handle(request);
      await untilFinished();
      // The real outbox starts sending right away; let it settle (no relation
      // row exists, so it stops before any network call).
      await outboxDispatcher.requestDrain();

      expect(response).toEqual({ kind: 'accepted' });
      expect(await answerRowsOf(request.requestId)).toMatchObject([
        { answer: { kind: 'failed', reason: 'agent-error' } },
      ]);
    });
  });

  describe('a re-sent request (same relationId and requestId)', () => {
    it('answers accepted both times and runs once', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner(neverSettles);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const request = agentRequest(actor);

      const first = await endpoint.handle(request);
      await afterResponseIsSent();
      const second = await endpoint.handle(request);
      await afterResponseIsSent();

      expect(first).toEqual({ kind: 'accepted' });
      expect(second).toEqual({ kind: 'accepted' });
      expect(runAgentRequest).toHaveBeenCalledTimes(1);
    });

    it('answers accepted and runs once when both copies arrive at the same time', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner(neverSettles);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const request = agentRequest(actor);

      const responses = await Promise.all([
        endpoint.handle(request),
        endpoint.handle(request),
      ]);
      await afterResponseIsSent();

      expect(responses).toEqual([{ kind: 'accepted' }, { kind: 'accepted' }]);
      expect(runAgentRequest).toHaveBeenCalledTimes(1);
    });

    it('answers accepted after the first run has finished, without running again', async () => {
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner();
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const request = agentRequest(actor);

      await endpoint.handle(request);
      await afterResponseIsSent();
      await ChatAgentRequest.updateMany({}, { state: 'done' });
      const resent = await endpoint.handle(request);
      await afterResponseIsSent();

      expect(resent).toEqual({ kind: 'accepted' });
      expect(runAgentRequest).toHaveBeenCalledTimes(1);
    });

    // Which unique index MongoDB reports for a row that breaks both is not
    // part of its contract (see tasks.md 5.2 notes); the answer must not
    // depend on it.
    it('is recognised whichever unique index reports the duplicate', async () => {
      await ChatAgentRequest.collection.dropIndexes();
      await ChatAgentRequest.collection.createIndex(
        { userId: 1 },
        {
          name: 'userId_1_running_unique',
          unique: true,
          partialFilterExpression: { state: 'running' },
        },
      );
      await ChatAgentRequest.collection.createIndex(
        { relationId: 1, requestId: 1 },
        { name: 'relationId_1_requestId_1_unique', unique: true },
      );
      const actor = nextActor();
      await createLinkedUser(actor);
      const runAgentRequest = fakeRunner(neverSettles);
      const endpoint = createCommandEndpoint(buildCrowi({ aiReady: true }), {
        runAgentRequest,
      });
      const request = agentRequest(actor);

      await endpoint.handle(request);
      await afterResponseIsSent();
      const resent = await endpoint.handle(request);
      await afterResponseIsSent();

      expect(resent).toEqual({ kind: 'accepted' });
      expect(runAgentRequest).toHaveBeenCalledTimes(1);
    });
  });
});
