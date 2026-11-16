import { generateKeyPairSync } from 'node:crypto';
import type { IncomingHttpHeaders, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentAnswer, CommandAnswerResult } from '@growi/chat';
import { OP_NAMES } from '@growi/chat';
import { verify } from '@growi/chat/server';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { storeOwnKey } from '../keys';
import type { ChatKeyEncryptionEnv } from '../keys/key-encryption';
import { ChatRelation } from '../models/chat-relation';
import { createChatOutbox } from './chat-outbox';
import { OUTBOX_DELIVERERS } from './deliverers';
import { ChatOutboxRow } from './models/chat-outbox';
import type { OutboxDispatcher } from './outbox-dispatcher';
import {
  CLAIM_STALE_AFTER_MS,
  createOutboxDispatcher,
} from './outbox-dispatcher';

// An answer row written with `chatOutbox.enqueue`, sent by the production
// deliverer table over real HTTP to a loopback fake proxy.

const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

const RELATION_ID = 'rel-answer-loopback';
const REQUEST_ID = 'req-agent-loopback';
const ANSWER: AgentAnswer = {
  kind: 'text',
  markdown: 'the answer',
  sources: [{ title: 'Page', url: 'https://growi.example.com/page' }],
};

interface ReceivedRequest {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

type Responder = (received: ReceivedRequest, res: ServerResponse) => void;

interface Latch {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

const createLatch = (): Latch => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

const respondJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const stringHeaders = (headers: IncomingHttpHeaders) =>
  Object.fromEntries(
    Object.entries(headers).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );

/** The row as stored, read past Mongoose so a removed field is really absent. */
const storedRow = () =>
  ChatOutboxRow.collection.findOne({
    relationId: RELATION_ID,
    requestId: REQUEST_ID,
  });

describe('sending a command answer through the production deliverer table', () => {
  let mongod: MongoMemoryServer | undefined;
  let server: Server;
  let proxyUri: string;
  let responder: Responder;
  let received: ReceivedRequest[];
  let publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'];
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_command_answer_delivery',
    ));
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const request: ReceivedRequest = {
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        received.push(request);
        responder(request, res);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    proxyUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    Object.assign(process.env, TEST_ENCRYPTION_KEY);
    const keyPair = generateKeyPairSync('ed25519');
    publicKey = keyPair.publicKey;
    await ChatRelation.create({
      relationId: RELATION_ID,
      proxyUri,
      platform: 'slack',
      workspaceId: 'workspace-1',
      workspaceName: 'Workspace One',
      label: null,
      state: 'active',
      settingsVersion: 0,
      createdAt: new Date(),
    });
    await storeOwnKey(
      { relationId: RELATION_ID, keyId: `${RELATION_ID}-key` },
      keyPair.privateKey,
    );
  });

  beforeEach(async () => {
    received = [];
    responder = (_r, res) => respondJson(res, 500, {});
    await ChatOutboxRow.deleteMany({});
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    server.closeAllConnections();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectSelfContainedMongo(mongod);
  });

  /**
   * Like the real proxy: the first request for a `requestId` is delivered,
   * any later one gets the first result back and is not delivered again.
   */
  const rememberingProxy = () => {
    const resultByRequestId = new Map<string, CommandAnswerResult>();
    let deliveries = 0;
    const answer = (request: ReceivedRequest, res: ServerResponse) => {
      const { requestId }: { requestId: string } = JSON.parse(request.body);
      const remembered = resultByRequestId.get(requestId);
      if (remembered != null) {
        respondJson(res, 200, remembered);
        return;
      }
      deliveries += 1;
      const result: CommandAnswerResult = { status: 'delivered' };
      resultByRequestId.set(requestId, result);
      respondJson(res, 200, result);
    };
    return { answer, deliveries: () => deliveries };
  };

  const enqueueWithoutSending = () =>
    createChatOutbox({ dispatcher: mock<OutboxDispatcher>() }).enqueue({
      kind: 'command-answer',
      relationId: RELATION_ID,
      requestId: REQUEST_ID,
      answer: ANSWER,
    });

  /**
   * One process claims the row and its first request hangs until
   * `releaseFirst`; another process takes the stale claim back and sends.
   */
  const sendFromStalledThenOtherProcess = async (
    firstArrived: Latch,
    releaseFirst: Latch,
  ) => {
    await enqueueWithoutSending();
    const stalled = createOutboxDispatcher({ deliverers: OUTBOX_DELIVERERS });
    const other = createOutboxDispatcher({ deliverers: OUTBOX_DELIVERERS });

    const stalledDrain = stalled.drain(new Date());
    await firstArrived.promise;
    await other.drain(new Date(Date.now() + CLAIM_STALE_AFTER_MS + 1000));
    releaseFirst.release();
    await stalledDrain;
  };

  const requestIdsReceived = () =>
    received.map((r) => {
      const { requestId }: { requestId: string } = JSON.parse(r.body);
      return requestId;
    });

  it('sends an enqueued answer once as a signed command-answer request, then keeps the row without the answer', async () => {
    const proxy = rememberingProxy();
    responder = proxy.answer;
    const dispatcher = createOutboxDispatcher({
      deliverers: OUTBOX_DELIVERERS,
    });

    await createChatOutbox({ dispatcher }).enqueue({
      kind: 'command-answer',
      relationId: RELATION_ID,
      requestId: REQUEST_ID,
      answer: ANSWER,
    });
    await dispatcher.requestDrain();

    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/chat-integration/command-answer');
    expect(JSON.parse(received[0].body)).toEqual({
      relationId: RELATION_ID,
      op: OP_NAMES.commandAnswer,
      requestId: REQUEST_ID,
      answer: ANSWER,
    });
    const verified = await verify({
      method: 'POST',
      headers: stringHeaders(received[0].headers),
      body: Buffer.from(received[0].body, 'utf8'),
      resolvePublicKey: async () => publicKey,
      consumeNonce: async () => true,
    });
    expect(verified.ok).toBe(true);
    expect(proxy.deliveries()).toBe(1);

    const row = await storedRow();
    expect(row).toMatchObject({
      kind: 'command-answer',
      relationId: RELATION_ID,
      requestId: REQUEST_ID,
      state: 'sent',
      result: { status: 'delivered' },
    });
    expect(row).not.toHaveProperty('answer');
  });

  it('stays sent when a stalled process’s send fails after another process took the row back and sent it', async () => {
    const proxy = rememberingProxy();
    const firstArrived = createLatch();
    const releaseFirst = createLatch();
    responder = (request, res) => {
      if (received.length === 1) {
        // Never reaches the proxy's delivery; the connection fails later.
        firstArrived.release();
        void releaseFirst.promise.then(() => respondJson(res, 500, {}));
        return;
      }
      proxy.answer(request, res);
    };

    await sendFromStalledThenOtherProcess(firstArrived, releaseFirst);

    expect(requestIdsReceived()).toEqual([REQUEST_ID, REQUEST_ID]);
    const row = await storedRow();
    expect(row).toMatchObject({
      state: 'sent',
      attempts: 0,
      result: { status: 'delivered' },
    });
    expect(row).not.toHaveProperty('answer');
  });
});
