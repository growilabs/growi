// A Slack post made with the options `adapter-set.ts` builds the Slack adapter
// with ends -- delivered or failed -- within one request deadline, whatever
// the server does. Driven through the real adapter against a loopback stand-in;
// real time throughout, since the bound is enforced by timers inside the HTTP
// client.
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSlackAdapter } from '@chat-adapter/slack';
import type { StateAdapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type {
  OutboundMessage,
  PostOutcome,
  SdkChannelRef,
} from '../types/index.js';
import { slackWebClientOptions } from './adapter-set.js';
import {
  ANSWER_DELIVERY_RECLAIM_MS,
  SLACK_REQUEST_DEADLINE_MS,
} from './answer-delivery-window.js';
import { BOT_USER_NAME } from './bot-factory.js';
import {
  type ChatServiceStandIn,
  type StandInResponder,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import { MAX_ORDERING_DELAY_MS } from './ephemeral-ordering.js';
import { postInThread } from './outbound.js';
import { createSdkLogger } from './sdk-logger.js';

const DEADLINE_MS = 300;
/** Room for the event loop and the loopback round trip; far below a retry. */
const SLACK_MS = 1_000;
const TEST_TIMEOUT_MS = 5_000;

const CHANNEL: SdkChannelRef = {
  platform: 'slack',
  channelId: toSdkChannelId('slack', 'slack:C0000000X'),
  channelName: 'general',
  isPrivate: false,
};
const THREAD_ROOT = '1700000000.000100';
const ANSWER: OutboundMessage = { kind: 'markdown', markdown: 'the answer' };

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const standIn = async (
  responder: StandInResponder,
): Promise<ChatServiceStandIn> => {
  const service = await startChatServiceStandIn(responder);
  closers.push(service.close);
  return service;
};

/** Posts the answer into the thread and times how long the post took. */
const timedPost = async (
  apiUrl: string,
): Promise<{ readonly outcome: PostOutcome; readonly elapsedMs: number }> => {
  const adapter = createSlackAdapter({
    botToken: 'xoxb-test',
    signingSecret: 'signing-secret',
    apiUrl,
    webClientOptions: slackWebClientOptions(DEADLINE_MS),
    logger: createSdkLogger(),
  });
  const startedAt = performance.now();
  const outcome = await postInThread(
    { adapter, state: mock<StateAdapter>(), botName: BOT_USER_NAME },
    CHANNEL,
    THREAD_ROOT,
    ANSWER,
  );
  return { outcome, elapsedMs: performance.now() - startedAt };
};

describe('a Slack post made with the production client options', () => {
  it(
    'fails within the deadline, without trying again, when Slack never answers',
    async () => {
      const slack = await standIn(() => new Promise(() => undefined));

      const { outcome, elapsedMs } = await timedPost(`${slack.url}/api/`);

      expect(outcome).toMatchObject({ ok: false, reason: 'platform-error' });
      expect(elapsedMs).toBeLessThan(DEADLINE_MS + SLACK_MS);
      expect(slack.requests).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'fails at once, without waiting out the rate limit, when Slack answers 429',
    async () => {
      const slack = await standIn(() => ({
        status: 429,
        headers: { 'retry-after': '600' },
        body: { ok: false, error: 'ratelimited' },
      }));

      const { outcome, elapsedMs } = await timedPost(`${slack.url}/api/`);

      expect(outcome).toMatchObject({ ok: false, reason: 'platform-error' });
      expect(elapsedMs).toBeLessThan(DEADLINE_MS + SLACK_MS);
      expect(slack.requests).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'fails within the deadline when Slack keeps the response open by sending a byte at a time',
    async () => {
      // An idle timeout restarts on every byte, so only a deadline on the whole
      // request ends this one.
      const responses: ServerResponse[] = [];
      const server: Server = createServer((_request, response) => {
        responses.push(response);
        response.writeHead(200, { 'content-type': 'application/json' });
        const drip = setInterval(() => response.write(' '), DEADLINE_MS / 6);
        response.on('close', () => clearInterval(drip));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      closers.push(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });
      const { port } = server.address() as AddressInfo;

      const { outcome, elapsedMs } = await timedPost(
        `http://127.0.0.1:${port}/api/`,
      );

      expect(outcome).toMatchObject({ ok: false, reason: 'platform-error' });
      expect(elapsedMs).toBeLessThan(DEADLINE_MS + SLACK_MS);
      expect(responses).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it('still delivers when Slack answers in time', async () => {
    const slack = await standIn(() => ({
      body: { ok: true, channel: 'C0000000X', ts: '1700000001.000200' },
    }));

    const { outcome } = await timedPost(`${slack.url}/api/`);

    expect(outcome).toEqual({ ok: true, messageId: '1700000001.000200' });
  });
});

describe('the Slack request deadline against the answer reclaim window', () => {
  it('lets the longest channel answer (five calls after the ordering wait) end within half the window', () => {
    expect(
      5 * SLACK_REQUEST_DEADLINE_MS + MAX_ORDERING_DELAY_MS,
    ).toBeLessThanOrEqual(ANSWER_DELIVERY_RECLAIM_MS / 2);
  });
});
