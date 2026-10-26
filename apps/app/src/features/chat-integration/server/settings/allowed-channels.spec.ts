// Proves the one thing that decides whether task 9.2 can express what
// Requirement 11.1 asks for: the stored shape of `allowedChannels` must be
// able to carry ALL THREE wire values ('all' / 'none' / an explicit channel
// list), and a value must survive the storage round trip unchanged.
//
// Tested as a pure round trip rather than through Mongoose, because the
// only thing that can break here is the translation itself -- and a
// property that holds for every wire value is exactly what
// `settingsPullHandler` promises the proxy ("returns them verbatim").

import { toNativeChannelId } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import {
  toStoredAllowedChannels,
  toWireAllowedChannels,
  type WireAllowedChannels,
} from './allowed-channels';

describe('allowedChannels storage translation', () => {
  const everyWireValue: ReadonlyArray<[string, WireAllowedChannels]> = [
    ['allowed in every channel', 'all'],
    ['allowed in no channel', 'none'],
    [
      'allowed in the listed channels',
      [toNativeChannelId('C0001'), toNativeChannelId('C0002')],
    ],
    // Distinct from 'none' on the wire even though `judge()` denies both:
    // an operator who cleared the list has not said "never allow this".
    ['an empty explicit list', []],
  ];

  it.each(
    everyWireValue,
  )('round trips %s unchanged', (_label, wireValue: WireAllowedChannels) => {
    const stored = toStoredAllowedChannels(wireValue);

    expect(toWireAllowedChannels(stored)).toEqual(wireValue);
  });

  it("does not leave a stale channel list behind when the scope is 'all' or 'none'", () => {
    // Otherwise a row switched from an explicit list to 'all' would still
    // carry the old ids, and any future reader that looks at
    // `allowedChannels` without first looking at `channelScope` would
    // silently apply the stale list.
    expect(toStoredAllowedChannels('all').allowedChannels).toEqual([]);
    expect(toStoredAllowedChannels('none').allowedChannels).toEqual([]);
  });

  it('reads a row written before channelScope existed as an explicit channel list', () => {
    // `chat_channel_permissions` rows created by earlier code have only
    // `allowedChannels`. Reading such a row as an explicit list is the only
    // interpretation that preserves what it used to mean.
    expect(
      toWireAllowedChannels({
        channelScope: undefined,
        allowedChannels: ['C0009'],
      }),
    ).toEqual(['C0009']);
  });

  it('reads the stored service-native id back as the id an administrator typed', () => {
    expect(
      toWireAllowedChannels({
        channelScope: 'listed',
        allowedChannels: ['C0CBFQ5558V'],
      }),
    ).toEqual([toNativeChannelId('C0CBFQ5558V')]);
  });

  it('leaves out a stored id in a chat adapter encoding instead of passing it on the protocol', () => {
    expect(
      toWireAllowedChannels({
        channelScope: 'listed',
        allowedChannels: ['slack:C0LEGACY', 'C0CBFQ5558V'],
      }),
    ).toEqual([toNativeChannelId('C0CBFQ5558V')]);
  });
});
