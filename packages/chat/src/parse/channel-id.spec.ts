import { describe, expect, it } from 'vitest';

import type { ChannelRef, NativeChannelId } from '../contract/common.js';
import { parseNativeChannelId, toNativeChannelId } from './channel-id.js';
import { parseChannelRef } from './common-fields.js';
import { parseNotificationRequest } from './parse-notification.js';
import { parseChannelInventory } from './parse-responses.js';
import { parseSettingsPush } from './parse-settings.js';

describe('parseNativeChannelId', () => {
  it.each([
    'C0CBFQ5558V',
    '1234567890123456789',
    'mmchan1',
    '19:abc@thread.tacv2',
  ])('accepts the id a service itself shows: %s', (id) => {
    expect(parseNativeChannelId(id)).toBe(id);
  });

  it.each([
    'slack:C0CBFQ5558V',
    'discord:G1:1',
    'teams:abc',
    'mattermost:abc',
  ])("refuses a chat adapter's own encoding: %s", (id) => {
    expect(parseNativeChannelId(id)).toBeUndefined();
  });

  it('refuses an empty, oversized or non-string value', () => {
    expect(parseNativeChannelId('')).toBeUndefined();
    expect(parseNativeChannelId('x'.repeat(201))).toBeUndefined();
    expect(parseNativeChannelId(42)).toBeUndefined();
  });
});

describe('toNativeChannelId', () => {
  it('answers the id it accepts', () => {
    expect(toNativeChannelId('C1')).toBe('C1');
  });

  it("throws on a chat adapter's own encoding, naming it", () => {
    expect(() => toNativeChannelId('slack:C1')).toThrow(/slack:C1/);
  });
});

describe('every field that carries a channel id on the wire refuses an adapter encoding', () => {
  it('ChannelRef', () => {
    expect(
      parseChannelRef({
        platform: 'slack',
        channelId: 'slack:C1',
        channelName: 'general',
        isPrivate: false,
      }),
    ).toBeUndefined();
  });

  it('a notification target', () => {
    expect(
      parseNotificationRequest({
        relationId: 'rel-1',
        op: 'notification',
        requestId: 'req-1',
        targets: [{ platform: 'slack', channelId: 'slack:C1' }],
        markdown: 'x',
        containsRestrictedPage: false,
      }),
    ).toHaveProperty('error');
  });

  it('a listed channel permission', () => {
    expect(
      parseSettingsPush({
        relationId: 'rel-1',
        op: 'settings-push',
        version: 1,
        settings: {
          relationId: 'rel-1',
          channelPermissions: [
            { commandName: 'create-page', allowedChannels: ['slack:C1'] },
          ],
        },
      }),
    ).toHaveProperty('error');
  });

  it('a channel inventory row', () => {
    expect(
      parseChannelInventory({
        channels: [
          {
            platform: 'slack',
            channelId: 'slack:C1',
            channelName: 'general',
            isPrivate: false,
          },
        ],
      }),
    ).toHaveProperty('error');
  });
});

describe('the channel id type cannot be produced from a plain string', () => {
  it('rejects a plain string where a channel id belongs', () => {
    const plain = 'slack:C1';
    const ref: ChannelRef = {
      platform: 'slack',
      // @ts-expect-error -- only `parseNativeChannelId` / `toNativeChannelId` produce one
      channelId: plain,
      channelName: 'general',
      isPrivate: false,
    };
    // @ts-expect-error -- a plain string is not a `NativeChannelId`
    const id: NativeChannelId = plain;
    expect([ref.channelId, id]).toEqual([plain, plain]);
  });
});
