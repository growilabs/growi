import { ChatNotificationDestination } from '../models/chat-notification-destination';
import { findGen2DestinationsForPathAndEvent } from './find-destinations-for-path-and-event';

vi.mock('../models/chat-notification-destination', () => ({
  ChatNotificationDestination: { find: vi.fn() },
}));

describe('findGen2DestinationsForPathAndEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by the same path-expansion generatePathsToMatch produces, and the given event', async () => {
    vi.mocked(ChatNotificationDestination.find).mockResolvedValue([]);

    await findGen2DestinationsForPathAndEvent('/a/b/c', 'pageCreate');

    expect(ChatNotificationDestination.find).toHaveBeenCalledWith({
      pathPattern: { $in: ['/a/b/c', '/a/b/*', '/a/*', '/*'] },
      triggerEvents: 'pageCreate',
    });
  });

  it('maps matched documents down to {relationId, platform, channelId} destinations', async () => {
    vi.mocked(ChatNotificationDestination.find).mockResolvedValue([
      {
        relationId: 'rel-1',
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      },
      {
        relationId: 'rel-2',
        platform: 'discord',
        channelId: 'D2',
        channelName: 'random',
        pathPattern: '/a/*',
        triggerEvents: ['pageCreate'],
      },
      // A platform value this function has never seen before must still be
      // passed through untouched -- this is what proves it does not branch
      // on platform (Requirement 12.2/12.3), matching DestinationRegistry's
      // own genericity requirement.
      {
        relationId: 'rel-1',
        platform: 'some-future-platform',
        channelId: 'X3',
        channelName: 'other',
        pathPattern: '/*',
        triggerEvents: ['pageCreate'],
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fixture doc, not a full Mongoose document
    ] as any);

    const result = await findGen2DestinationsForPathAndEvent(
      '/a/b',
      'pageCreate',
    );

    expect(result).toEqual([
      { relationId: 'rel-1', platform: 'slack', channelId: 'C1' },
      { relationId: 'rel-2', platform: 'discord', channelId: 'D2' },
      {
        relationId: 'rel-1',
        platform: 'some-future-platform',
        channelId: 'X3',
      },
    ]);
  });
});
