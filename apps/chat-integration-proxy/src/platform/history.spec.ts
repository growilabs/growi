// Task 3.5: 「期間を指定した発言の履歴の取り出し」 -- the `fetchHistory` half.
//
// What is asserted here is the observable contract: which messages come back
// for a given `TimeRange`, in which order, and -- when the bot cannot read the
// channel -- which `HistoryOutcome` reason and remedy the caller gets so it can
// tell the user what to do (Requirement 5.4). The Chat SDK's own paging is
// third-party code and is not re-tested; what *is* tested is that this module
// keeps asking for older pages until the range is covered and then stops.
import type { ChannelRef } from '@growi/chat';
import { type Adapter, Message } from 'chat';
import { mock } from 'vitest-mock-extended';

import type { TimeRange } from '../types/index.js';
import { fetchHistory, type HistoryContext } from './history.js';

const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: 'slack:C123',
  channelName: 'general',
  isPrivate: false,
};

/**
 * `Required<Adapter>` for the same reason `outbound.spec.ts` uses it: the SDK
 * marks `fetchChannelMessages` optional, and a mock of the optional shape is
 * typed as possibly-undefined. The one test that wants it *absent* removes it
 * explicitly.
 */
const adapterMock = () => mock<Required<Adapter>>();

const contextOf = (adapter: Adapter): HistoryContext => ({ adapter });

const at = (iso: string) => new Date(iso);

/**
 * A real `Message`, not a hand-shaped object: `FetchResult.messages` is typed
 * as the SDK's `Message` class, so constructing one is both type-safe and free
 * of the assertions `.claude/rules/testing.md` rules out.
 */
const messageAt = (id: string, iso: string, text: string, userId = 'U1') =>
  new Message({
    id,
    threadId: 'slack:C123:1700000000.000100',
    text,
    formatted: { type: 'root', children: [] },
    raw: {},
    author: {
      userId,
      userName: 'someone',
      fullName: 'Some One',
      isBot: false,
      isMe: false,
    },
    metadata: { dateSent: at(iso), edited: false },
    attachments: [],
  });

const RANGE: TimeRange = {
  since: at('2026-09-01T00:00:00.000Z'),
  until: at('2026-09-02T00:00:00.000Z'),
};

describe('fetchHistory', () => {
  it('returns the messages posted inside the range, oldest first', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [
        messageAt('m1', '2026-09-01T09:00:00.000Z', 'first'),
        messageAt('m2', '2026-09-01T10:00:00.000Z', 'second'),
      ],
    });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(outcome).toEqual({
      ok: true,
      messages: [
        {
          postedAt: '2026-09-01T09:00:00.000Z',
          author: {
            platform: 'slack',
            accountId: 'U1',
            displayName: 'Some One',
          },
          text: 'first',
        },
        {
          postedAt: '2026-09-01T10:00:00.000Z',
          author: {
            platform: 'slack',
            accountId: 'U1',
            displayName: 'Some One',
          },
          text: 'second',
        },
      ],
    });
  });

  it('asks the channel, not the thread, for its messages', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({ messages: [] });

    await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(adapter.fetchChannelMessages).toHaveBeenCalledWith(
      'slack:C123',
      expect.objectContaining({ direction: 'backward' }),
    );
    expect(adapter.fetchMessages).not.toHaveBeenCalled();
  });

  it('drops messages posted outside the range', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [
        messageAt('too-old', '2026-08-31T23:59:59.000Z', 'before'),
        messageAt('inside', '2026-09-01T12:00:00.000Z', 'inside'),
        messageAt('too-new', '2026-09-02T00:00:01.000Z', 'after'),
      ],
    });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.messages.map((message) => message.text)).toEqual(['inside']);
  });

  it('keeps asking for older pages until the range is covered, then stops', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages
      .mockResolvedValueOnce({
        messages: [messageAt('m3', '2026-09-01T20:00:00.000Z', 'newest')],
        nextCursor: 'page-1',
      })
      .mockResolvedValueOnce({
        messages: [messageAt('m2', '2026-09-01T10:00:00.000Z', 'middle')],
        nextCursor: 'page-2',
      })
      // This page reaches back past `since`, so there is nothing older left to
      // ask for even though the SDK still offers a cursor.
      .mockResolvedValueOnce({
        messages: [messageAt('m1', '2026-08-31T10:00:00.000Z', 'older')],
        nextCursor: 'page-3',
      });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(adapter.fetchChannelMessages).toHaveBeenCalledTimes(3);
    expect(adapter.fetchChannelMessages).toHaveBeenNthCalledWith(
      2,
      'slack:C123',
      expect.objectContaining({ cursor: 'page-1' }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.messages.map((message) => message.text)).toEqual([
      'middle',
      'newest',
    ]);
  });

  it('stops when the service runs out of pages', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [messageAt('m1', '2026-09-01T10:00:00.000Z', 'only')],
    });

    await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(adapter.fetchChannelMessages).toHaveBeenCalledTimes(1);
  });

  it('answers with no messages rather than a failure when the range is empty', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [messageAt('m1', '2026-08-01T10:00:00.000Z', 'long before')],
    });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(outcome).toEqual({ ok: true, messages: [] });
  });

  it('keeps the in-range half of the page that reaches back past the start, and stops there', async () => {
    const adapter = adapterMock();
    adapter.fetchChannelMessages
      .mockResolvedValueOnce({
        // One message inside the range and one before it, on the same page:
        // this is the boundary the stop condition governs.
        messages: [
          messageAt('before', '2026-08-31T23:00:00.000Z', 'before'),
          messageAt('inside', '2026-09-01T01:00:00.000Z', 'inside'),
        ],
        nextCursor: 'page-1',
      })
      .mockResolvedValueOnce({
        messages: [messageAt('older', '2026-08-30T10:00:00.000Z', 'older')],
      });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(adapter.fetchChannelMessages).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.messages.map((message) => message.text)).toEqual(['inside']);
  });

  it('gives up after a bounded number of pages instead of paging forever', async () => {
    const adapter = adapterMock();
    // Every page sits inside the range and offers another cursor, so only the
    // page cap can end the loop.
    adapter.fetchChannelMessages.mockResolvedValue({
      messages: [messageAt('m', '2026-09-01T10:00:00.000Z', 'inside')],
      nextCursor: 'more',
    });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(outcome.ok).toBe(true);
    // The bound itself is the contract, so it is asserted exactly: raising it
    // raises how long one command can spend before answering.
    expect(adapter.fetchChannelMessages).toHaveBeenCalledTimes(20);
  });

  it('says the service cannot do this at all when its adapter reads no channel history', async () => {
    const adapter = adapterMock();
    Object.defineProperty(adapter, 'fetchChannelMessages', {
      value: undefined,
      configurable: true,
    });

    const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a failure');
    expect(outcome.reason).toBe('unsupported');
    expect(outcome.remedy).not.toBe('');
  });

  describe('a failure the user can act on (Requirement 5.4)', () => {
    /** The real shape `@slack/web-api` throws and the Slack adapter rethrows. */
    const slackPlatformError = (error: string) =>
      Object.assign(new Error(`An API error occurred: ${error}`), {
        code: 'slack_webapi_platform_error',
        data: { ok: false, error },
      });

    const adapterError = (name: string, adapter: string, message: string) =>
      Object.assign(new Error(message), { name, adapter });

    it.each([
      [
        'slack says the bot is not in the channel',
        slackPlatformError('not_in_channel'),
      ],
      [
        'slack cannot find the channel',
        slackPlatformError('channel_not_found'),
      ],
      [
        'discord cannot find the channel',
        adapterError('NetworkError', 'discord', 'Discord API error: 404 {}'),
      ],
      [
        // Discord's access model is channel-membership-based: 403 / error
        // code 50001 ("Missing Access") means the bot has not been added to
        // this channel, same fix as a 404 -- unlike Teams, where the same
        // HTTP status means a missing Graph API permission instead.
        'discord is denied access to the channel',
        adapterError(
          'NetworkError',
          'discord',
          'Discord API error: 403 {"message":"Missing Access","code":50001}',
        ),
      ],
      [
        'mattermost refuses a non-member',
        adapterError(
          'PermissionError',
          'mattermost',
          'Permission denied: cannot /channels/x/posts in mattermost',
        ),
      ],
      [
        'teams cannot find the conversation',
        adapterError(
          'NetworkError',
          'teams',
          'Resource not found during fetchChannelMessages: conversation or message may no longer exist',
        ),
      ],
    ])('reports not-in-channel when %s', async (_label, error) => {
      const adapter = adapterMock();
      adapter.fetchChannelMessages.mockRejectedValue(error);

      const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected a failure');
      expect(outcome.reason).toBe('not-in-channel');
      expect(outcome.remedy).not.toBe('');
    });

    it.each([
      [
        'slack is missing the history scope',
        slackPlatformError('missing_scope'),
      ],
      [
        'teams has not been granted the graph permission',
        adapterError(
          'PermissionError',
          'teams',
          'Permission denied: cannot fetchChannelMessages in teams',
        ),
      ],
    ])('reports not-permitted when %s', async (_label, error) => {
      const adapter = adapterMock();
      adapter.fetchChannelMessages.mockRejectedValue(error);

      const outcome = await fetchHistory(contextOf(adapter), CHANNEL, RANGE);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected a failure');
      expect(outcome.reason).toBe('not-permitted');
      expect(outcome.remedy).not.toBe('');
    });

    it('tells the two apart with different remedies, so the reader is not sent to fix the wrong thing', async () => {
      const notInChannel = adapterMock();
      notInChannel.fetchChannelMessages.mockRejectedValue(
        slackPlatformError('not_in_channel'),
      );
      const notPermitted = adapterMock();
      notPermitted.fetchChannelMessages.mockRejectedValue(
        slackPlatformError('missing_scope'),
      );

      const first = await fetchHistory(contextOf(notInChannel), CHANNEL, RANGE);
      const second = await fetchHistory(
        contextOf(notPermitted),
        CHANNEL,
        RANGE,
      );

      if (first.ok || second.ok) throw new Error('expected two failures');
      expect(first.remedy).not.toBe(second.remedy);
    });

    it('lets an unrecognised failure through rather than dressing it up as something the user can fix', async () => {
      const adapter = adapterMock();
      adapter.fetchChannelMessages.mockRejectedValue(
        new Error('socket hang up'),
      );

      await expect(
        fetchHistory(contextOf(adapter), CHANNEL, RANGE),
      ).rejects.toThrow('socket hang up');
    });
  });
});
