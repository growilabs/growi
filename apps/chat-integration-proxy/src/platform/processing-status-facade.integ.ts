// Through the real facade: the processing indicator reaches Slack's
// `assistant.threads.setStatus` only when the operator enabled the AI app view
// (`PlatformAppConfig.slack.agentView`), and nothing else is sent on a service
// without one. The Slack adapter is built as in production, with only
// `setAssistantStatus` replaced so no request leaves the process.
import { SlackAdapter } from '@chat-adapter/slack';
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
const STATE_CONNECTION_STRING =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

const SLACK_TEAM = 'T0000000X';
const REQUEST_TS = '1793094064.140309';

const appConfigOf = (agentView?: boolean): PlatformAppConfig => ({
  slack: {
    signingSecret: 'signing-secret',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    appToken: 'xapp-1-test',
    ...(agentView == null ? {} : { agentView }),
  },
  stateConnectionString: STATE_CONNECTION_STRING,
});

const directMessage: SdkChannelRef = {
  platform: 'slack',
  channelId: toSdkChannelId('slack', 'slack:D0DIRECT01'),
  channelName: 'direct',
  isPrivate: true,
};

describe('setProcessingStatus through the facade, on Slack', () => {
  let facade: PlatformFacade | undefined;

  // Records the bot token the call would be sent with. Slack resolves it from
  // the installation the call is bound to; an unbound call has none.
  const tokensUsed: string[] = [];
  const setStatus = vi
    .spyOn(SlackAdapter.prototype, 'setAssistantStatus')
    .mockImplementation(async function (this: SlackAdapter) {
      tokensUsed.push(
        await Reflect.apply(Reflect.get(this, 'getToken'), this, []),
      );
    });

  const reportOperationalFailure = vi.fn();

  const open = async (config: PlatformAppConfig): Promise<PlatformFacade> => {
    facade = await createPlatformFacade(
      config,
      mock<InstallationProvider>({
        list: async () => [
          { installationId: 'installation-x', workspaceId: SLACK_TEAM },
        ],
        resolve: async () => ({ slack: { botToken: 'xoxb-installation-x' } }),
      }),
      mock<PlatformEventSink>(),
      { reportOperationalFailure },
    );
    return facade;
  };

  beforeEach(() => {
    setStatus.mockClear();
    tokensUsed.length = 0;
    reportOperationalFailure.mockClear();
  });
  afterEach(async () => {
    await facade?.shutdown();
    facade = undefined;
  });

  it('shows the indicator on the request thread when the AI app view is enabled', async () => {
    const opened = await open(appConfigOf(true));

    await opened.setProcessingStatus(directMessage, REQUEST_TS, {
      installationId: 'installation-x',
    });

    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(
      'D0DIRECT01',
      REQUEST_TS,
      expect.any(String),
    );
    expect(tokensUsed).toEqual(['xoxb-installation-x']);
  });

  it.each([
    ['explicitly disabled', false],
    ['left at its default', undefined],
  ])('sends nothing when the AI app view is %s', async (_label, agentView) => {
    const opened = await open(appConfigOf(agentView));

    await opened.setProcessingStatus(directMessage, REQUEST_TS, {
      installationId: 'installation-x',
    });

    expect(setStatus).not.toHaveBeenCalled();
  });

  it('answers normally, without throwing, when Slack refuses the status', async () => {
    const opened = await open(appConfigOf(true));
    setStatus.mockRejectedValueOnce(new Error('missing_scope'));

    await expect(
      opened.setProcessingStatus(directMessage, REQUEST_TS, {
        installationId: 'installation-x',
      }),
    ).resolves.toBeUndefined();
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a service that has no indicator, even with the AI app view enabled', async () => {
    const opened = await open({
      ...appConfigOf(true),
      discord: {
        applicationId: 'discord-app-id',
        publicKey: '0'.repeat(64),
        clientSecret: 'discord-client-secret',
        botToken: 'discord-bot-token',
      },
    });
    const discordDm: SdkChannelRef = {
      platform: 'discord',
      channelId: toSdkChannelId('discord', 'discord:@me:910000000000000002'),
      channelName: 'direct',
      isPrivate: true,
    };

    await expect(
      opened.setProcessingStatus(discordDm, REQUEST_TS, {
        installationId: 'installation-x',
      }),
    ).resolves.toBeUndefined();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
