import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import type {
  CapabilityLevel,
  CapabilityReport,
  ChannelInventory,
  ConnectionHealth,
  ConnectionStatusView,
  RelationSettings,
  SettingsPullResponse,
  SettingsPushRequest,
} from './settings.js';

// Most of this spec is a shape probe (same treatment as command.spec.ts /
// notification.spec.ts / pairing.spec.ts): types-only file, no runtime
// logic of its own. The one exception is the version-staleness test below,
// which the task explicitly calls out: `version: number` must genuinely
// support "decide staleness from the version alone" (task 3.4's acceptance
// line), not merely type-check like one.

describe('RelationSettings', () => {
  it('carries one channel-permission row per command, without a per-row scope field (Requirement 11.1, 11.2)', () => {
    const settings: RelationSettings = {
      relationId: 'rel-1',
      channelPermissions: [
        { commandName: 'search', allowedChannels: 'all' },
        { commandName: 'create-page', allowedChannels: ['C1', 'C2'] },
        { commandName: 'keep', allowedChannels: 'none' },
      ],
    };
    expect(settings.channelPermissions).toHaveLength(3);
    expect(settings.channelPermissions[1]).toEqual({
      commandName: 'create-page',
      allowedChannels: ['C1', 'C2'],
    });
    // `scope` (broadcast vs single) is deliberately absent from each row --
    // that knowledge lives only in COMMAND_TRAITS.targeting, structurally
    // there is no field here to duplicate it in.
    // @ts-expect-error -- `scope` is not a declared field on a permission row
    expect(settings.channelPermissions[0].scope).toBeUndefined();
  });

  it('matches allowedChannels by channelId, never by channelName (Requirement 11.3 rationale)', () => {
    // The type only accepts an array of channelId strings (or 'all'/'none'),
    // so there is structurally no place to pass a channel name for matching.
    const settings: RelationSettings = {
      relationId: 'rel-1',
      channelPermissions: [
        { commandName: 'search', allowedChannels: ['C-general'] },
      ],
    };
    expect(settings.channelPermissions[0].allowedChannels).toEqual([
      'C-general',
    ]);
  });
});

describe('ConnectionHealth / ConnectionStatusView', () => {
  it('declares exactly the four values Req 1.4 needs, with held-by-other folded into connected', () => {
    const values: ReadonlyArray<ConnectionHealth> = [
      'connected',
      'reconnecting',
      'failed',
      'not-applicable',
    ];
    expect(new Set(values).size).toBe(4);

    const view: ConnectionStatusView = {
      platform: 'slack',
      health: 'connected',
      since: '2026-09-01T00:00:00.000Z',
    };
    expect(view.health).toBe('connected');
  });

  it('cannot assign a health value outside the declared vocabulary (structural probe)', () => {
    const buildWithUnknownHealth = (): ConnectionStatusView => {
      const bogus: ConnectionStatusView = {
        platform: 'slack',
        // @ts-expect-error -- 'disconnected' was never declared; held-by-other must map to 'connected' instead
        health: 'disconnected',
        since: '2026-09-01T00:00:00.000Z',
      };
      return bogus;
    };
    expect(typeof buildWithUnknownHealth).toBe('function');
  });
});

describe('CapabilityReport', () => {
  it('reports capability level as one of four values that never assume an unverified capability works (Requirement 1.3)', () => {
    const levels: ReadonlyArray<CapabilityLevel> = [
      'full',
      'degraded',
      'none',
      'unverified',
    ];
    expect(new Set(levels).size).toBe(4);

    const report: CapabilityReport = {
      platforms: [
        {
          platform: 'teams',
          capabilities: [
            {
              capability: 'interactive-input',
              level: 'none',
              substitute: 'slash-command-args',
            },
            {
              capability: 'history-fetch',
              level: 'unverified',
              substitute: null,
            },
          ],
        },
      ],
    };
    expect(report.platforms[0].capabilities[1].level).toBe('unverified');
  });
});

describe('ChannelInventory', () => {
  it('carries channelName alongside channelId, for Requirement 12.4 target-overlap matching', () => {
    const inventory: ChannelInventory = {
      channels: [
        {
          platform: 'slack',
          channelId: 'C1',
          channelName: 'general',
          isPrivate: false,
        },
      ],
    };
    expect(inventory.channels[0].channelName).toBe('general');
  });
});

describe('SettingsPushRequest / SettingsPullResponse -- version-based staleness (Requirement 11.4)', () => {
  it('shapes a push request carrying one version per relation, not per row', () => {
    const push: SettingsPushRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.settingsPush,
      settings: {
        relationId: 'rel-1',
        channelPermissions: [{ commandName: 'search', allowedChannels: 'all' }],
      },
      version: 3,
    };
    expect(push.version).toBe(3);
  });

  it('lets proxy decide staleness using only the version field, as a plain numeric comparison', () => {
    // This is the task's explicit acceptance line: "a type is declared, and
    // whether a push is stale can be decided from the version alone."
    // We don't implement the real discard function here (that belongs to
    // whatever processes SettingsPushRequest later) -- we prove the FIELD
    // itself is sufficient: a bare `incoming.version > stored.version`
    // correctly identifies which of two pushes is newer, with no other
    // input needed.
    const olderPush: SettingsPushRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.settingsPush,
      settings: { relationId: 'rel-1', channelPermissions: [] },
      version: 5,
    };
    const newerPush: SettingsPushRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.settingsPush,
      settings: { relationId: 'rel-1', channelPermissions: [] },
      version: 6,
    };

    // Simulates proxy's stored state as of after receiving `olderPush`.
    let stored: SettingsPushRequest = olderPush;

    // A late-arriving retry of an even-older push must be discarded.
    const staleRetry: SettingsPushRequest = { ...olderPush, version: 4 };
    const shouldAcceptStaleRetry = staleRetry.version > stored.version;
    expect(shouldAcceptStaleRetry).toBe(false);

    // A genuinely newer push must be accepted.
    const shouldAcceptNewer = newerPush.version > stored.version;
    expect(shouldAcceptNewer).toBe(true);
    stored = newerPush;

    // Two consecutive saves are two distinct integers, never colliding --
    // unlike a timestamp, which can repeat within the same millisecond.
    expect(newerPush.version).not.toBe(olderPush.version);
    expect(Number.isInteger(newerPush.version)).toBe(true);
  });

  it('lets proxy decide replacement for a pulled fallback using the same version comparison', () => {
    const stored = { version: 2 };
    const pulled: SettingsPullResponse = {
      settings: { relationId: 'rel-1', channelPermissions: [] },
      version: 3,
    };
    const olderPulled: SettingsPullResponse = {
      settings: { relationId: 'rel-1', channelPermissions: [] },
      version: 1,
    };

    expect(pulled.version > stored.version).toBe(true);
    expect(olderPulled.version > stored.version).toBe(false);
  });
});
