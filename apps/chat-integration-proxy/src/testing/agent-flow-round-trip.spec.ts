// Task 3.2's completion criterion, against the fake GROWI over a real socket:
// for each way GROWI can answer an `agent` request -- accepted, an account
// link required, a refusal -- and for no answer in time, whether the request's
// record is kept and what the requester is told.
//
// The proxy side is the real `GrowiClient` / `GrowiUriResolver` and the real
// `PrivateReplier` on the fake chat service, so what is asserted is what a
// chat user would see. Only the storage is an in-memory stand-in: the record's
// round trip through PostgreSQL is `storage-round-trip.integ.ts`'s job.

import { COMMAND_NAMES, OP_NAMES } from '@growi/chat';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPrivateReplier,
  privateReplyOriginOf,
} from '../command/index.js';
import type {
  NewPendingAgentRequest,
  PendingAgentRequestRecord,
} from '../db/index.js';
import { createGrowiClient } from '../growi/index.js';
import { createAgentFlow } from '../orchestration/index.js';
import { createGrowiUriResolver } from '../relation/index.js';
import type { Invocation, Relation } from '../types/index.js';
import { actorOn, channelOn } from './chat-events.js';
import { createFakeChatService } from './fake-chat-service.js';
import { type OpResponder, startFakeGrowi } from './fake-growi.js';
import { createSigningIdentity } from './signing-identity.js';

const RELATION_ID = 'relation-agent';
const INSTALLATION_ID = 'inst-agent';
/**
 * Short, so the no-answer case does not wait the production 10 seconds. Only
 * that case gets it: a slow machine must not turn an answer into no answer.
 */
const SHORT_REQUEST_TIMEOUT_MS = 100;

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const run = async (responder: OpResponder, requestTimeoutMs?: number) => {
  const growi = await startFakeGrowi({
    responders: { [OP_NAMES.command]: responder },
  });
  closers.push(growi.close);

  const identity = createSigningIdentity(RELATION_ID, 'proxy-key-0001');
  growi.registerPeerKey(identity.asPeerKey);
  const growiClient = createGrowiClient({
    uriResolver: createGrowiUriResolver({
      closedNetwork: {
        allowList: [growi.hostname],
        trustedCaCertsFor: () => [],
      },
      requestTimeoutMs,
    }),
    keyService: {
      signerFor: async () => ({
        key: identity.key,
        privateKey: identity.privateKey,
      }),
    },
  });

  const chat = createFakeChatService();
  const facade = await chat.createFacade(
    { stateConnectionString: 'unused' },
    { list: () => Promise.resolve([]), resolve: () => Promise.resolve(null) },
    { handle: async () => {} },
  );

  const stored = new Map<string, PendingAgentRequestRecord>();
  const reports: string[] = [];
  const entry = createAgentFlow({
    growiClient,
    pendingAgentRequests: {
      create: (request: NewPendingAgentRequest) => {
        const record: PendingAgentRequestRecord = {
          ...request,
          deliveryStatus: null,
          deliveryClaimedAt: null,
        };
        stored.set(request.requestId, record);
        return Promise.resolve(record);
      },
      delete: async (_relationId, requestId) =>
        stored.delete(requestId) ? 1 : 0,
    },
    privateReplier: createPrivateReplier({
      platform: facade,
      describePlace: async () => null,
      resolveInstallationId: async () => null,
      reportUndeliverable: () => {},
    }),
    platform: facade,
    reportOperationalFailure: (message) => {
      reports.push(message);
    },
  });

  const relation: Relation = {
    relationId: RELATION_ID,
    installationId: INSTALLATION_ID,
    growiUri: growi.baseUrl,
    growiLabel: 'Team Wiki',
    searchWeight: 1,
    settingsVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const invocation: Invocation = {
    platform: 'slack',
    channel: channelOn('slack'),
    actor: actorOn('slack'),
    commandName: COMMAND_NAMES.agent,
    argsText: 'summarise this thread',
    interaction: null,
    sourceMessageId: 'M-1',
  };

  await entry({
    invocation,
    origin: privateReplyOriginOf(invocation, INSTALLATION_ID),
    relation,
    text: 'summarise this thread',
    conversationKey: 'slack:C1:M-1',
  });

  return {
    growi,
    chat,
    stored: () => [...stored.values()],
    reports: () => [...reports],
    /** What the requester alone was shown. */
    privateTexts: () =>
      chat
        .posts()
        .filter((post) => post.user?.accountId === invocation.actor.accountId)
        .map((post) =>
          post.message.kind === 'markdown' ? post.message.markdown : '',
        ),
  };
};

describe('an agent request answered by a fake GROWI', () => {
  it('keeps the record under the id GROWI received, reacts to the request, and says nothing more when GROWI accepts', async () => {
    const outcome = await run(() => ({ body: { kind: 'accepted' } }));

    const [received] = outcome.growi.received();
    expect(received?.body).toMatchObject({
      kind: COMMAND_NAMES.agent,
      text: 'summarise this thread',
      conversationKey: 'slack:C1:M-1',
    });
    expect(outcome.stored().map((record) => record.requestId)).toEqual([
      received?.body.requestId,
    ]);
    expect(outcome.chat.reactions()).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ messageId: 'M-1' }),
        reaction: 'eyes',
      }),
    ]);
    expect(outcome.chat.posts()).toEqual([]);
  });

  it('drops the record and sends the requester the link when GROWI asks for an account link', async () => {
    const outcome = await run(() => ({
      body: {
        kind: 'account-link-required',
        growiLabel: 'Team Wiki',
        linkUrl: 'https://wiki.example.com/link/once',
      },
    }));

    expect(outcome.stored()).toEqual([]);
    expect(outcome.privateTexts()).toEqual([
      expect.stringContaining('<https://wiki.example.com/link/once>'),
    ]);
  });

  it('drops the record and passes the refusal on to the requester when GROWI refuses', async () => {
    const outcome = await run(() => ({
      body: {
        kind: 'error',
        code: 'busy',
        message: '前の依頼を処理しています。',
      },
    }));

    expect(outcome.stored()).toEqual([]);
    expect(outcome.privateTexts()).toEqual([
      'GROWI「Team Wiki」で実行できませんでした: 前の依頼を処理しています。',
    ]);
  });

  it('keeps the record and tells the requester the answer may still come when GROWI does not answer in time', async () => {
    const outcome = await run(
      () => new Promise(() => {}),
      SHORT_REQUEST_TIMEOUT_MS,
    );

    expect(outcome.stored()).toHaveLength(1);
    expect(outcome.privateTexts()).toEqual([
      'GROWI「Team Wiki」から、受け付けの返事が時間内に届きませんでした。依頼が受け付けられていれば、答えが後から届くことがあります。',
    ]);
    expect(outcome.reports()).toHaveLength(1);
  });
});
