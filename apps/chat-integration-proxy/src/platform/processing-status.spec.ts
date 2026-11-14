// The processing indicator's contract below the facade: which services have
// one, when the operator's setting turns it off, and what reaches Slack. The
// Slack adapter is real; only its HTTP goes to a local stand-in. No database.
import { createSlackAdapter } from '@chat-adapter/slack';
import type { PlatformName } from '@growi/chat';
import type { StateAdapter } from 'chat';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type { PlatformAppConfig, SdkChannelRef } from '../types/index.js';
import { ADAPTER_FACTORIES, processingStatusSetterOf } from './adapter-set.js';
import {
  type ChatServiceStandIn,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import type { InstallationProvider } from './installation-provider.js';
import { installationRunner } from './installation-scope.js';
import { setProcessingStatus } from './outbound.js';
import { createSlackInstallationLookup } from './slack-installation-lookup.js';

const REQUEST_TS = '1793094064.140309';

const appConfigOf = (agentView?: boolean): PlatformAppConfig => ({
  slack: {
    signingSecret: 'signing-secret',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    appToken: 'xapp-1-test',
    ...(agentView == null ? {} : { agentView }),
  },
  stateConnectionString: 'postgres://unused',
});

const directMessage: SdkChannelRef = {
  platform: 'slack',
  channelId: toSdkChannelId('slack', 'slack:D0DIRECT01'),
  channelName: 'direct',
  isPrivate: true,
};

describe('the processing indicator', () => {
  let service: ChatServiceStandIn;
  let slackAnswer: unknown;

  beforeEach(async () => {
    slackAnswer = { ok: true };
    service = await startChatServiceStandIn(() => ({ body: slackAnswer }));
  });
  afterEach(() => service.close());

  // Built as in production: no `botToken`, so the bot is resolved from the
  // installation the call is bound to. A call that is not bound has no token.
  const slackContext = () => {
    const installations = mock<InstallationProvider>({
      list: async () => [
        { installationId: 'installation-x', workspaceId: 'T0000000X' },
      ],
      resolve: async () => ({ slack: { botToken: 'xoxb-installation-x' } }),
    });
    const adapter = createSlackAdapter({
      mode: 'socket',
      appToken: 'xapp-1-test',
      signingSecret: 'signing-secret',
      installationProvider: createSlackInstallationLookup({
        installations,
        fetch: (input, init) =>
          fetch(new URL(new URL(String(input)).pathname, service.url), init),
      }),
      apiUrl: `${service.url}/api/`,
      webClientOptions: { retryConfig: { retries: 0 } },
    });
    return {
      adapter,
      state: mock<StateAdapter>(),
      botName: 'growi',
      run:
        installationRunner('slack', adapter, 'installation-x', {
          installations,
          factories: ADAPTER_FACTORIES,
        }) ?? undefined,
    };
  };

  const show = async (
    agentView: boolean | undefined,
    report?: (message: string, error: unknown) => void,
  ) =>
    setProcessingStatus(slackContext(), directMessage, REQUEST_TS, {
      set: processingStatusSetterOf(
        'slack',
        appConfigOf(agentView),
        ADAPTER_FACTORIES,
      ),
      ...(report == null ? {} : { report }),
    });

  it('asks Slack to show a status on the request thread when the AI app view is enabled', async () => {
    await show(true);

    expect(service.requests).toHaveLength(1);
    expect(service.requests[0]?.path).toBe('/api/assistant.threads.setStatus');
    expect(service.requests[0]?.authorization).toBe(
      'Bearer xoxb-installation-x',
    );
    expect(service.requests[0]?.body).toMatchObject({
      channel_id: 'D0DIRECT01',
      thread_ts: REQUEST_TS,
      status: expect.stringMatching(/\S/),
    });
  });

  it.each([
    ['disabled', false],
    ['left at its default', undefined],
  ])('sends nothing to Slack when the AI app view is %s', async (_label, agentView) => {
    await show(agentView);

    expect(service.requests).toEqual([]);
  });

  it.each([
    'discord',
    'teams',
    'mattermost',
  ] satisfies PlatformName[])('has no indicator on %s, whatever the Slack setting', (platform) => {
    expect(
      processingStatusSetterOf(platform, appConfigOf(true), ADAPTER_FACTORIES),
    ).toBeNull();
  });

  it('reports a refusal from Slack instead of throwing', async () => {
    slackAnswer = { ok: false, error: 'missing_scope' };
    const reported: unknown[] = [];

    await expect(
      show(true, (_message, error) => reported.push(error)),
    ).resolves.toBeUndefined();
    expect(reported).toHaveLength(1);
  });
});
