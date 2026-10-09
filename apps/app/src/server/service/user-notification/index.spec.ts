import { mock } from 'vitest-mock-extended';

const { dispatchAll, createGen2NotificationDispatcher, loggerError } =
  vi.hoisted(() => ({
    dispatchAll: vi.fn().mockResolvedValue([]),
    createGen2NotificationDispatcher: vi.fn().mockReturnValue(vi.fn()),
    loggerError: vi.fn(),
  }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
  }),
}));

vi.mock('~/features/chat-integration/server/notification', () => ({
  DestinationRegistry: vi.fn().mockImplementation((destinations) => ({
    destinations,
    dispatchAll: (dispatch: (d: unknown) => Promise<void>) =>
      dispatchAll(destinations, dispatch),
  })),
  createGen2NotificationDispatcher,
}));

vi.mock('../growi-info', () => ({
  growiInfoService: { getSiteUrl: () => 'https://growi.example.com' },
}));

vi.mock('../../util/slack', () => ({
  prepareSlackMessageForComment: vi.fn().mockReturnValue({}),
  prepareSlackMessageForPage: vi.fn().mockReturnValue({}),
}));

import type Crowi from '~/server/crowi';

import { UserNotificationService } from '.';

describe('UserNotificationService.fire', () => {
  const user = { username: 'someone' };

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchAll.mockResolvedValue([]);
    createGen2NotificationDispatcher.mockReturnValue(vi.fn());
  });

  it('dispatches Gen 2 destinations even when Slack is not configured and Gen 1 was not requested', async () => {
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: { isSlackConfigured: false },
    });
    const service = new UserNotificationService(crowi);
    const page = {
      path: '/a',
      grant: 1,
      updateSlackChannels: vi.fn(),
    };
    const gen2Destinations = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
    ];

    const results = await service.fire(
      page,
      user,
      '', // no Gen 1 slack channels requested
      'create',
      undefined,
      {},
      gen2Destinations,
      false, // isSlackEnabled: caller explicitly did not request Gen 1
    );

    expect(dispatchAll).toHaveBeenCalledWith(
      gen2Destinations,
      expect.any(Function),
    );
    // Content is built before the dispatcher factory is invoked -- proves
    // real markdown reaches enqueue, not a placeholder.
    expect(createGen2NotificationDispatcher).toHaveBeenCalledWith(
      expect.stringContaining('someone created'),
      false,
    );
    expect(results).toEqual([]);
    // Gen 1 was not requested, so the page's stored slackChannels field
    // must be left untouched, not cleared.
    expect(page.updateSlackChannels).not.toHaveBeenCalled();
  });

  it('does NOT build content or dispatch when there are no Gen 2 destinations for this save', async () => {
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: {
        isSlackConfigured: true,
        postMessage: vi.fn(),
      },
    });
    const service = new UserNotificationService(crowi);
    const page = { path: '/a', grant: 1, updateSlackChannels: vi.fn() };

    await service.fire(page, user, '', 'create', undefined, {}, [], true);

    expect(createGen2NotificationDispatcher).not.toHaveBeenCalled();
    expect(dispatchAll).not.toHaveBeenCalled();
  });

  it('still runs Gen 1 (including page.updateSlackChannels) when isSlackEnabled is true even with an empty channel string', async () => {
    // Regression test: a user can enable the "post to Slack" toggle while
    // leaving/clearing the channels text field (SlackNotification.tsx keeps
    // these as independent form state). Before this fix, an early return
    // keyed on "channel array is empty" skipped page.updateSlackChannels()
    // entirely in this case, leaving the page's stored slackChannels field
    // stale instead of persisting the explicitly-saved empty value.
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: {
        isSlackConfigured: true,
        postMessage,
      },
    });
    const service = new UserNotificationService(crowi);
    const page = { path: '/a', grant: 1, updateSlackChannels: vi.fn() };

    const results = await service.fire(
      page,
      user,
      '', // channels field was cleared
      'create',
      undefined,
      {},
      [],
      true, // isSlackEnabled: caller explicitly requested Gen 1
    );

    expect(page.updateSlackChannels).toHaveBeenCalledWith('');
    expect(postMessage).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('still throws when Gen 1 Slack channels are requested but Slack is not configured (Gen 1 behavior unchanged)', async () => {
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: { isSlackConfigured: false },
    });
    const service = new UserNotificationService(crowi);
    const page = { path: '/a', grant: 1, updateSlackChannels: vi.fn() };

    await expect(service.fire(page, user, 'general', 'create')).rejects.toThrow(
      'slackIntegrationService has not been set up',
    );

    // Gen 2 had nothing to dispatch (no destinations passed) -- unaffected
    // by the Gen 1 throw either way.
    expect(dispatchAll).not.toHaveBeenCalled();
  });

  it('sends to Gen 1 Slack channels as before when Slack is configured', async () => {
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: {
        isSlackConfigured: true,
        postMessage,
      },
    });
    const service = new UserNotificationService(crowi);
    const page = { path: '/a', grant: 1, updateSlackChannels: vi.fn() };

    const results = await service.fire(page, user, 'general,dev', 'create');

    expect(page.updateSlackChannels).toHaveBeenCalledWith('general,dev');
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it('logs a failed Gen 2 destination outcome with identifying detail, and does NOT log the destination that dispatched fine (dispatchAll result is not silently discarded)', async () => {
    const okDestination = {
      relationId: 'rel-ok',
      platform: 'slack',
      channelId: 'C-OK',
    };
    const failedDestination = {
      relationId: 'rel-1',
      platform: 'slack',
      channelId: 'C1',
    };
    const gen2Destinations = [okDestination, failedDestination];
    dispatchAll.mockResolvedValue([
      { destination: okDestination, outcome: 'dispatched' },
      { destination: failedDestination, outcome: 'failed' },
    ]);
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: { isSlackConfigured: false },
    });
    const service = new UserNotificationService(crowi);
    const page = { path: '/a', grant: 1, updateSlackChannels: vi.fn() };

    await service.fire(
      page,
      user,
      '',
      'create',
      undefined,
      {},
      gen2Destinations,
      false,
    );

    // Exactly one log call -- proves the guard actually discriminates
    // outcome, rather than logging every dispatched destination.
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        relationId: 'rel-1',
        platform: 'slack',
        channelId: 'C1',
      }),
      expect.stringContaining('failed'),
    );
  });

  it('a Gen 2 dispatch failure does not prevent Gen 1 from still sending (independence)', async () => {
    createGen2NotificationDispatcher.mockImplementation(() => {
      throw new Error('outbox unavailable');
    });
    const postMessage = vi.fn().mockResolvedValue(undefined);
    const crowi = mock<Crowi>({
      appService: { getAppTitle: () => 'GROWI' },
      slackIntegrationService: {
        isSlackConfigured: true,
        postMessage,
      },
    });
    const service = new UserNotificationService(crowi);
    const page = { path: '/a', grant: 1, updateSlackChannels: vi.fn() };
    const gen2Destinations = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
    ];

    const results = await service.fire(
      page,
      user,
      'general',
      'create',
      undefined,
      {},
      gen2Destinations,
      true,
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });
});
