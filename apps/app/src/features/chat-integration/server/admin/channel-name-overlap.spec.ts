// Requirement 12.4's rule, on its own: given what Gen 2 stores and what
// Gen 1 stores, which channels does an administrator have to be warned
// about? Every case below is stated as "what does the caller see", so the
// rule can be reshaped freely as long as the warnings stay the same.

import { describe, expect, it } from 'vitest';

import {
  type ComparableDestination,
  findChannelNameOverlaps,
} from './channel-name-overlap';

const destination = (
  overrides: Partial<ComparableDestination> = {},
): ComparableDestination => ({
  platform: 'slack',
  channelId: 'C0001',
  channelName: 'general',
  ...overrides,
});

describe('findChannelNameOverlaps', () => {
  it('warns about a channel that is a destination on both sides', () => {
    expect(
      findChannelNameOverlaps([destination()], ['general', 'random']),
    ).toEqual([{ channelId: 'C0001', channelName: 'general' }]);
  });

  it('stays silent when no Gen 2 destination names a Gen 1 channel', () => {
    expect(
      findChannelNameOverlaps([destination()], ['random', 'announcements']),
    ).toEqual([]);
  });

  it('stays silent when Gen 1 has no destination at all', () => {
    expect(findChannelNameOverlaps([destination()], [])).toEqual([]);
  });

  it('reports only the overlapping destinations, not the whole set', () => {
    const overlaps = findChannelNameOverlaps(
      [
        destination({ channelId: 'C0001', channelName: 'general' }),
        destination({ channelId: 'C0002', channelName: 'random' }),
        destination({ channelId: 'C0003', channelName: 'dev' }),
      ],
      ['dev', 'general'],
    );

    expect(overlaps).toEqual([
      { channelId: 'C0001', channelName: 'general' },
      { channelId: 'C0003', channelName: 'dev' },
    ]);
  });

  it("matches a Gen 1 entry an operator typed as '#general' with surrounding spaces and capitals", () => {
    // Gen 1's channel list is hand-typed free text, so these are the SAME
    // channel as the one Gen 2 stored -- missing them would leave the
    // administrator with no warning at all, which is the expensive failure
    // here (double posting goes unnoticed).
    expect(findChannelNameOverlaps([destination()], ['  #General  '])).toEqual([
      { channelId: 'C0001', channelName: 'general' },
    ]);
  });

  it("matches a Gen 1 entry typed as '# general', with a space after the hash", () => {
    // Slack itself renders a channel as "# general" in some places, so an
    // operator copying that into Gen 1's hand-typed list still means the
    // channel Gen 2 stored as `general`.
    expect(findChannelNameOverlaps([destination()], ['# general'])).toEqual([
      { channelId: 'C0001', channelName: 'general' },
    ]);
  });

  it('does not warn about a same-named channel on a service Gen 1 cannot post to', () => {
    expect(
      findChannelNameOverlaps(
        [destination({ platform: 'discord', channelName: 'general' })],
        ['general'],
      ),
    ).toEqual([]);
  });

  it('ignores blank Gen 1 entries rather than matching everything', () => {
    // A trailing comma in Gen 1's `slackChannels` yields an empty entry; if
    // it were compared literally, a destination whose name is somehow empty
    // would be reported, and worse, an all-blank Gen 1 list would look
    // populated.
    expect(
      findChannelNameOverlaps(
        [destination({ channelName: '' }), destination()],
        ['', '   ', '#'],
      ),
    ).toEqual([]);
  });
});
