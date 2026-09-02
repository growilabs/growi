import { describe, expect, it } from 'vitest';

import { COMMAND_NAMES } from '../commands/command-names.js';
import type { ChannelRef } from '../contract/common.js';
import type { RelationSettings } from '../contract/settings.js';
import { filterBroadcastTargets, judge } from './channel-permission.js';

const channel = (channelId: string, channelName = 'general'): ChannelRef => ({
  platform: 'slack',
  channelId,
  channelName,
  isPrivate: false,
});

describe('judge', () => {
  describe('default-value parity (settings never received vs. no row for this command)', () => {
    // Requirement 11.1 / task 4.1: these two shapes are both "nothing was
    // ever configured for this command" from the caller's point of view, so
    // the answer must be identical -- a function whose whole reason to
    // exist is "both sides agree" cannot leave this case undecided.
    const settingsWithNoMatchingRow: RelationSettings = {
      relationId: 'r1',
      channelPermissions: [],
    };

    it('denies a write command with reason no-settings, identically for null and no-row settings', () => {
      const fromNull = judge(null, COMMAND_NAMES.createPage, channel('C1'));
      const fromNoRow = judge(
        settingsWithNoMatchingRow,
        COMMAND_NAMES.createPage,
        channel('C1'),
      );

      expect(fromNull).toEqual({ allowed: false, reason: 'no-settings' });
      expect(fromNoRow).toEqual(fromNull);
    });

    it('allows a non-write command identically for null and no-row settings', () => {
      const fromNull = judge(null, COMMAND_NAMES.search, channel('C1'));
      const fromNoRow = judge(
        settingsWithNoMatchingRow,
        COMMAND_NAMES.search,
        channel('C1'),
      );

      expect(fromNull).toEqual({ allowed: true });
      expect(fromNoRow).toEqual(fromNull);
    });
  });

  describe('allowedChannels forms', () => {
    it('"all" allows every channel', () => {
      const settings: RelationSettings = {
        relationId: 'r1',
        channelPermissions: [
          { commandName: COMMAND_NAMES.createPage, allowedChannels: 'all' },
        ],
      };

      expect(judge(settings, COMMAND_NAMES.createPage, channel('C1'))).toEqual({
        allowed: true,
      });
      expect(judge(settings, COMMAND_NAMES.createPage, channel('C2'))).toEqual({
        allowed: true,
      });
    });

    it('"none" denies every channel with reason not-permitted-in-channel', () => {
      const settings: RelationSettings = {
        relationId: 'r1',
        channelPermissions: [
          { commandName: COMMAND_NAMES.createPage, allowedChannels: 'none' },
        ],
      };

      expect(judge(settings, COMMAND_NAMES.createPage, channel('C1'))).toEqual({
        allowed: false,
        reason: 'not-permitted-in-channel',
      });
    });

    it('an array allows only listed channelIds and denies everything else', () => {
      const settings: RelationSettings = {
        relationId: 'r1',
        channelPermissions: [
          {
            commandName: COMMAND_NAMES.createPage,
            allowedChannels: ['C1', 'C2'],
          },
        ],
      };

      expect(judge(settings, COMMAND_NAMES.createPage, channel('C1'))).toEqual({
        allowed: true,
      });
      expect(judge(settings, COMMAND_NAMES.createPage, channel('C3'))).toEqual({
        allowed: false,
        reason: 'not-permitted-in-channel',
      });
    });
  });

  describe('id-only channel matching (Requirement 11.3)', () => {
    it('permits by channelId even when channelName differs from anything ever stored', () => {
      // Settings never store a name at all -- only channelIds -- so this is
      // largely implicit, but assert it directly: a channel whose name is
      // totally unrelated to the stored id list is still permitted.
      const settings: RelationSettings = {
        relationId: 'r1',
        channelPermissions: [
          {
            commandName: COMMAND_NAMES.createPage,
            allowedChannels: ['C1'],
          },
        ],
      };

      expect(
        judge(
          settings,
          COMMAND_NAMES.createPage,
          channel('C1', 'renamed-channel'),
        ),
      ).toEqual({ allowed: true });
    });

    it('judges two different channelIds that share the same channelName independently', () => {
      const settings: RelationSettings = {
        relationId: 'r1',
        channelPermissions: [
          {
            commandName: COMMAND_NAMES.createPage,
            allowedChannels: ['C1'],
          },
        ],
      };

      expect(
        judge(settings, COMMAND_NAMES.createPage, channel('C1', 'general')),
      ).toEqual({ allowed: true });
      expect(
        judge(settings, COMMAND_NAMES.createPage, channel('C2', 'general')),
      ).toEqual({ allowed: false, reason: 'not-permitted-in-channel' });
    });
  });
});

describe('filterBroadcastTargets', () => {
  it('returns every relation, including excluded ones with their individual reason', () => {
    // Uses createPage (a write command, "single" targeting in reality) purely
    // to exercise the no-settings default -- filterBroadcastTargets itself
    // doesn't care about targeting, it judges whatever commandName it's given.
    const settingsByRelation = [
      // Allowed: explicit array match.
      {
        relationId: 'r-allowed',
        settings: {
          relationId: 'r-allowed',
          channelPermissions: [
            { commandName: COMMAND_NAMES.createPage, allowedChannels: ['C1'] },
          ],
        } satisfies RelationSettings,
      },
      // Excluded: never received settings at all -- write command defaults to denied.
      { relationId: 'r-no-settings', settings: null },
      // Excluded: settings exist but this channel isn't in the list.
      {
        relationId: 'r-not-permitted',
        settings: {
          relationId: 'r-not-permitted',
          channelPermissions: [
            {
              commandName: COMMAND_NAMES.createPage,
              allowedChannels: ['OTHER'],
            },
          ],
        } satisfies RelationSettings,
      },
    ];

    const result = filterBroadcastTargets(
      settingsByRelation,
      COMMAND_NAMES.createPage,
      channel('C1'),
    );

    expect(result).toEqual([
      { relationId: 'r-allowed', verdict: { allowed: true } },
      {
        relationId: 'r-no-settings',
        verdict: { allowed: false, reason: 'no-settings' },
      },
      {
        relationId: 'r-not-permitted',
        verdict: { allowed: false, reason: 'not-permitted-in-channel' },
      },
    ]);
  });

  it('judges each relation independently rather than aggregating to a single verdict', () => {
    // A non-write, broadcast-target command (search) is allowed by default
    // (no-settings default is "allowed" for non-write commands), while a
    // relation with an explicit 'none' is excluded -- proving the function
    // does not collapse to "all allowed" or "all denied" based on one relation.
    const settingsByRelation = [
      { relationId: 'r-default-allowed', settings: null },
      {
        relationId: 'r-explicit-none',
        settings: {
          relationId: 'r-explicit-none',
          channelPermissions: [
            { commandName: COMMAND_NAMES.search, allowedChannels: 'none' },
          ],
        } satisfies RelationSettings,
      },
    ];

    const result = filterBroadcastTargets(
      settingsByRelation,
      COMMAND_NAMES.search,
      channel('C1'),
    );

    expect(result).toEqual([
      { relationId: 'r-default-allowed', verdict: { allowed: true } },
      {
        relationId: 'r-explicit-none',
        verdict: { allowed: false, reason: 'not-permitted-in-channel' },
      },
    ]);
  });
});
