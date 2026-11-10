// Through the real facade: a Slack private reply waits for the request's next
// second when it is told which message it answers, and the facade is what
// carries that message id down to the Slack call. The Slack adapter is built
// as in production (nothing connects until `reconcile`), with only its
// `postEphemeral` replaced so no request leaves the process.
import { SlackAdapter } from '@chat-adapter/slack';
import type { ChatAccountRef } from '@growi/chat';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type {
  PlatformAppConfig,
  PlatformEventSink,
  SdkChannelRef,
} from '../types/index.js';
import { createPlatformFacade, type PlatformFacade } from './index.js';
import type { InstallationProvider } from './installation-provider.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const APP_CONFIG: PlatformAppConfig = {
  slack: {
    signingSecret: 'signing-secret',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    appToken: 'xapp-1-test',
  },
  stateConnectionString:
    process.env.CHAT_SDK_DATABASE_URL ??
    `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`,
};

const REQUEST_ID = '1793094064.140309';
const SAME_SECOND_NOW = 1793094064 * 1000 + 600;

const channel: SdkChannelRef = {
  platform: 'slack',
  channelId: toSdkChannelId('slack', 'slack:C0000000X'),
  channelName: 'general',
  isPrivate: false,
};
const alice: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U0ALICE01',
  displayName: 'Alice',
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('postEphemeral through the facade, on Slack', () => {
  let facade: PlatformFacade;
  const slept: number[] = [];
  let release: () => void = () => undefined;
  let nowMs = SAME_SECOND_NOW;
  const holdSleep = (ms: number): Promise<void> => {
    slept.push(ms);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  let sleepWith: (ms: number) => Promise<void> = holdSleep;
  const waited: number[] = [];

  const send = vi
    .spyOn(SlackAdapter.prototype, 'postEphemeral')
    .mockResolvedValue({
      id: 'eph-1',
      raw: {},
      threadId: 'slack:C0000000X:',
      usedFallback: false,
    });

  beforeEach(async () => {
    slept.length = 0;
    nowMs = SAME_SECOND_NOW;
    sleepWith = holdSleep;
    waited.length = 0;
    send.mockClear();
    facade = await createPlatformFacade(
      APP_CONFIG,
      mock<InstallationProvider>({ list: async () => [] }),
      mock<PlatformEventSink>(),
      {
        orderingClock: {
          now: () => nowMs,
          sleep: (ms) => sleepWith(ms),
        },
        onOrderingWait: (ms) => void waited.push(ms),
      },
    );
  });

  afterEach(() => facade.shutdown());

  const reply = (requestMessageId: string | null) =>
    facade.postEphemeral(
      channel,
      alice,
      { kind: 'markdown', markdown: 'reply body' },
      { requestMessageId },
    );

  it('holds the post until the request second has passed, then posts', async () => {
    const pending = reply(REQUEST_ID);
    await flush();

    expect(slept).toEqual([1793094065 * 1000 + 250 - SAME_SECOND_NOW]);
    expect(send).not.toHaveBeenCalled();

    release();
    await expect(pending).resolves.toEqual({ ok: true, messageId: 'eph-1' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(waited).toEqual(slept);
  });

  it('posts at once when no request message is named', async () => {
    await expect(reply(null)).resolves.toEqual({
      ok: true,
      messageId: 'eph-1',
    });
    expect(slept).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caps the wait when the proxy clock is far behind the request', async () => {
    nowMs = 0;
    sleepWith = (ms) => {
      slept.push(ms);
      return Promise.resolve();
    };

    await reply(REQUEST_ID);

    expect(slept).toEqual([1500]);
  });

  it('still posts when the sleep fails', async () => {
    sleepWith = () => Promise.reject(new Error('sleep broke'));

    await expect(reply(REQUEST_ID)).resolves.toEqual({
      ok: true,
      messageId: 'eph-1',
    });
  });

  it('answers a failed post as the usual failure outcome after the wait', async () => {
    sleepWith = () => Promise.resolve();
    send.mockRejectedValueOnce(
      Object.assign(new Error('An API error occurred: channel_not_found'), {
        code: 'slack_webapi_platform_error',
        data: { ok: false, error: 'channel_not_found' },
      }),
    );

    const outcome = await reply(REQUEST_ID);

    expect(outcome.ok).toBe(false);
  });
});
