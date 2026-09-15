import { PageGrant } from '@growi/core';
import type { IUser } from '@growi/core/dist/interfaces';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';

const {
  mailFire,
  slackFire,
  findGen2DestinationsForPathAndEvent,
  createGen2NotificationDispatcher,
  dispatchAll,
  loggerError,
} = vi.hoisted(() => ({
  mailFire: vi.fn().mockResolvedValue(undefined),
  slackFire: vi.fn().mockResolvedValue(undefined),
  findGen2DestinationsForPathAndEvent: vi.fn().mockResolvedValue([]),
  createGen2NotificationDispatcher: vi.fn().mockReturnValue(vi.fn()),
  dispatchAll: vi.fn().mockResolvedValue([]),
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

vi.mock('./global-notification-mail', () => ({
  GlobalNotificationMailService: vi.fn().mockImplementation(() => ({
    fire: mailFire,
  })),
}));
vi.mock('./global-notification-slack', () => ({
  GlobalNotificationSlackService: vi.fn().mockImplementation(() => ({
    fire: slackFire,
  })),
}));

vi.mock('~/features/chat-integration/server/notification', () => ({
  DestinationRegistry: vi.fn().mockImplementation((destinations) => ({
    destinations,
    dispatchAll: (dispatch: (d: unknown) => Promise<void>) =>
      dispatchAll(destinations, dispatch),
  })),
  createGen2NotificationDispatcher,
  findGen2DestinationsForPathAndEvent: (...args: unknown[]) =>
    findGen2DestinationsForPathAndEvent(...args),
}));

vi.mock('../growi-info', () => ({
  growiInfoService: { getSiteUrl: () => 'https://growi.example.com' },
}));

import { GlobalNotificationService } from '.';

describe('GlobalNotificationService.fire', () => {
  const triggeredBy = mock<IUser>({ username: 'someone' });
  const page = mock<PageDocument>({
    path: '/a/b/c',
    grant: PageGrant.GRANT_PUBLIC,
    id: 'page-id',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findGen2DestinationsForPathAndEvent.mockResolvedValue([]);
    dispatchAll.mockResolvedValue([]);
    createGen2NotificationDispatcher.mockReturnValue(vi.fn());
  });

  it("calls Gen 1's mail and slack sends exactly as before (unchanged call shape)", async () => {
    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    await service.fire('pageCreate', page, triggeredBy);

    expect(mailFire).toHaveBeenCalledWith('pageCreate', page, triggeredBy, {});
    expect(slackFire).toHaveBeenCalledWith(
      'pageCreate',
      'page-id',
      '/a/b/c',
      triggeredBy,
      {},
    );
  });

  it('additionally resolves and dispatches Gen 2 destinations for the same path + event', async () => {
    const gen2Destinations = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
    ];
    findGen2DestinationsForPathAndEvent.mockResolvedValue(gen2Destinations);

    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    await service.fire('pageCreate', page, triggeredBy);

    expect(findGen2DestinationsForPathAndEvent).toHaveBeenCalledWith(
      '/a/b/c',
      'pageCreate',
    );
    // The content (markdown/containsRestrictedPage) is built once and
    // threaded into the dispatcher factory before dispatch -- proves
    // enqueue receives NotificationContent's output, not a placeholder.
    expect(createGen2NotificationDispatcher).toHaveBeenCalledWith(
      expect.stringContaining('someone created'),
      false,
    );
    expect(dispatchAll).toHaveBeenCalledWith(
      gen2Destinations,
      expect.any(Function),
    );
  });

  it('does NOT resolve Gen 2 destinations at all when there are none configured (no content built, no dispatch)', async () => {
    findGen2DestinationsForPathAndEvent.mockResolvedValue([]);

    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    await service.fire('pageCreate', page, triggeredBy);

    expect(mailFire).toHaveBeenCalled();
    expect(slackFire).toHaveBeenCalled();
    expect(createGen2NotificationDispatcher).not.toHaveBeenCalled();
    expect(dispatchAll).not.toHaveBeenCalled();
  });

  it('still fires Gen 2 for a non-public page -- with the body withheld -- while Gen 1 stays silent (Requirement 2.3)', async () => {
    const restrictedPage = mock<PageDocument>({
      path: '/a/b/c',
      grant: PageGrant.GRANT_RESTRICTED,
      id: 'page-id',
      revision: mock<PageDocument['revision']>({ body: 'SECRET PAGE BODY' }),
    });
    const gen2Destinations = [
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
    ];
    findGen2DestinationsForPathAndEvent.mockResolvedValue(gen2Destinations);

    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    await service.fire('pageCreate', restrictedPage, triggeredBy);

    // Gen 2 fires, the restriction flag reaches the dispatcher (Requirement
    // 2.4), and the restricted page's actual body never reaches it -- proves
    // the withholding is real, not just an untested claim (a mock with no
    // `revision.body` would pass this assertion even if withholding broke).
    expect(createGen2NotificationDispatcher).toHaveBeenCalledWith(
      expect.not.stringContaining('SECRET PAGE BODY'),
      true,
    );
    expect(dispatchAll).toHaveBeenCalledWith(
      gen2Destinations,
      expect.any(Function),
    );
    // Gen 1's own early return for a non-public page is unchanged.
    expect(mailFire).not.toHaveBeenCalled();
    expect(slackFire).not.toHaveBeenCalled();
  });

  it("still fires Gen 2 when Gen 1's mail send throws (Requirement 12.3)", async () => {
    findGen2DestinationsForPathAndEvent.mockResolvedValue([
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
    ]);
    // Once: `vi.clearAllMocks()` does not restore an implementation, so a
    // persistent rejection here would leak into the following tests.
    mailFire.mockRejectedValueOnce(new Error('smtp down'));

    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    // Gen 1's own failure propagation is intentionally left as it was.
    await expect(service.fire('pageCreate', page, triggeredBy)).rejects.toThrow(
      'smtp down',
    );

    expect(dispatchAll).toHaveBeenCalled();
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
    findGen2DestinationsForPathAndEvent.mockResolvedValue([
      okDestination,
      failedDestination,
    ]);
    dispatchAll.mockResolvedValue([
      { destination: okDestination, outcome: 'dispatched' },
      { destination: failedDestination, outcome: 'failed' },
    ]);

    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    await service.fire('pageCreate', page, triggeredBy);

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

  it('does not let a Gen 2 dispatch failure reject fire() after Gen 1 already sent', async () => {
    findGen2DestinationsForPathAndEvent.mockRejectedValue(
      new Error('db unavailable'),
    );

    const crowi = mock<Crowi>();
    const service = new GlobalNotificationService(crowi);

    await expect(
      service.fire('pageCreate', page, triggeredBy),
    ).resolves.toBeUndefined();
    expect(mailFire).toHaveBeenCalled();
    expect(slackFire).toHaveBeenCalled();
  });
});
