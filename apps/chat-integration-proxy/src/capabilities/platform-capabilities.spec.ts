import type { PlatformName } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import {
  buildCapabilityReport,
  CAPABILITY_TABLE,
  CONNECTION_UNIT_TABLE,
  levelOf,
  REQUIRES_INBOUND_REACHABILITY,
  supports,
} from './platform-capabilities.js';

// design.md's プラットフォーム能力表 lists exactly these 4 services -- not
// re-derived from CAPABILITY_TABLE's own keys, so a bug that drops a service
// from the table's declaration cannot also hide from this list.
const ALL_PLATFORMS: readonly PlatformName[] = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

describe('CAPABILITY_TABLE completeness', () => {
  it('has a defined CapabilityLevel for every (capability, service) pair, for every declared capability -- without hardcoding the capability count', () => {
    // Deriving the capability list from the table itself (not a literal
    // count) is the point of task 1.6's acceptance criterion: adding a 10th
    // capability to CAPABILITY_TABLE must make this test cover it
    // automatically, with no edit to this file.
    const capabilityNames = Object.keys(CAPABILITY_TABLE);
    expect(capabilityNames.length).toBeGreaterThan(0);

    for (const capabilityName of capabilityNames) {
      const row =
        CAPABILITY_TABLE[capabilityName as keyof typeof CAPABILITY_TABLE];
      for (const platform of ALL_PLATFORMS) {
        expect(row[platform]).toBeDefined();
        // This literal mirrors `@growi/chat`'s `CapabilityLevel` union
        // ('full' | 'degraded' | 'none' | 'unverified'). It is a type-only
        // union with no runtime array exported to iterate instead -- if
        // `@growi/chat` ever adds/removes a level, update this list to match.
        expect(['full', 'degraded', 'none', 'unverified']).toContain(
          row[platform],
        );
      }
    }
  });
});

describe('supports()', () => {
  it('returns true only when the level is full', () => {
    expect(supports('ephemeralMessage', 'slack')).toBe(true);
    expect(levelOf('ephemeralMessage', 'slack')).toBe('full');
  });

  it('returns false for a degraded capability (Mattermost card)', () => {
    expect(levelOf('card', 'mattermost')).toBe('degraded');
    expect(supports('card', 'mattermost')).toBe(false);
  });

  it('returns false for a none capability (Discord modal)', () => {
    expect(levelOf('modal', 'discord')).toBe('none');
    expect(supports('modal', 'discord')).toBe(false);
  });

  it('returns false for an unverified capability (plainReply, every service)', () => {
    for (const platform of ALL_PLATFORMS) {
      expect(levelOf('plainReply', platform)).toBe('unverified');
      expect(supports('plainReply', platform)).toBe(false);
    }
  });
});

describe('design.md-declared capability values (spot checks)', () => {
  it('matches the ○/△/×/要確認 table for a representative sample', () => {
    // Task 12.2: `command/invocation.ts` never strips the leading `/` a real
    // adapter sends on a slash command, so no service can actually invoke a
    // command this way today -- all four rows read `none` (see
    // `platform-capabilities.ts`'s comment on this row and `invocation.spec.ts`).
    expect(levelOf('slashCommand', 'slack')).toBe('none');
    expect(levelOf('slashCommand', 'discord')).toBe('none');
    expect(levelOf('slashCommand', 'teams')).toBe('none');
    expect(levelOf('slashCommand', 'mattermost')).toBe('none');
    expect(levelOf('modal', 'discord')).toBe('none');
    expect(levelOf('modal', 'teams')).toBe('full');
    expect(levelOf('interactiveActions', 'mattermost')).toBe('none');
    expect(levelOf('linkPreview', 'slack')).toBe('full');
    expect(levelOf('linkPreview', 'discord')).toBe('none');
    expect(levelOf('linkPreview', 'teams')).toBe('none');
    expect(levelOf('linkPreview', 'mattermost')).toBe('none');
    expect(levelOf('fetchMessages', 'teams')).toBe('full');
  });
});

describe('connection-unit axis (separate from the capability table)', () => {
  it('gives Slack and Discord a per-app connection', () => {
    expect(CONNECTION_UNIT_TABLE.slack).toEqual({
      kind: 'per-app',
      lockKey: 'app:slack',
    });
    expect(CONNECTION_UNIT_TABLE.discord).toEqual({
      kind: 'per-app',
      lockKey: 'app:discord',
    });
  });

  it('gives Teams no persistent connection', () => {
    expect(CONNECTION_UNIT_TABLE.teams).toEqual({ kind: 'none' });
  });

  it('gives Mattermost a per-installation connection', () => {
    expect(CONNECTION_UNIT_TABLE.mattermost).toEqual({
      kind: 'per-installation',
      lockKeyPrefix: 'installation:',
    });
  });
});

describe('inbound-reachability axis (separate from the capability table)', () => {
  it('requires inbound reachability only for Teams', () => {
    expect(REQUIRES_INBOUND_REACHABILITY).toEqual({
      slack: false,
      discord: false,
      teams: true,
      mattermost: false,
    });
  });
});

describe('buildCapabilityReport() (Requirement 1.3)', () => {
  it('reports every (service, capability) pair the table declares', () => {
    // `CapabilityReport`'s `capability` field is a plain `string`, so nothing
    // in the type system makes this report complete -- the check has to be
    // here. Derived from the table rather than a literal count, for the same
    // reason the completeness test above is.
    const report = buildCapabilityReport();
    const capabilityNames = Object.keys(CAPABILITY_TABLE);

    expect(report.platforms.map((entry) => entry.platform).sort()).toEqual(
      [...ALL_PLATFORMS].sort(),
    );
    for (const entry of report.platforms) {
      expect(entry.capabilities.map((row) => row.capability).sort()).toEqual(
        [...capabilityNames].sort(),
      );
    }
  });

  it('carries the level straight from the table', () => {
    const report = buildCapabilityReport();

    for (const entry of report.platforms) {
      for (const row of entry.capabilities) {
        expect(row.level).toBe(
          CAPABILITY_TABLE[row.capability as keyof typeof CAPABILITY_TABLE][
            entry.platform
          ],
        );
      }
    }
  });

  it('names a substitute exactly where a capability is not fully usable', () => {
    // design.md's 「無いときの代わり」 column is per capability, while the wire
    // shape carries one substitute per (service, capability) pair. A `full`
    // level has nothing to fall back to, so it reads `null` there; every row
    // that is not `full` and has a documented fallback carries its text.
    const report = buildCapabilityReport();

    for (const entry of report.platforms) {
      for (const row of entry.capabilities) {
        if (row.level === 'full') {
          expect(row.substitute).toBeNull();
        }
      }
    }

    const substituteOf = (platform: PlatformName, capability: string) =>
      report.platforms
        .find((entry) => entry.platform === platform)
        ?.capabilities.find((row) => row.capability === capability)?.substitute;

    // The three rows design.md gives a fallback for, at the levels it gives
    // them: a degraded one, a missing one, and an unverified one.
    expect(substituteOf('mattermost', 'card')).toEqual(expect.any(String));
    expect(substituteOf('teams', 'slashCommand')).toEqual(expect.any(String));
    expect(substituteOf('slack', 'plainReply')).toEqual(expect.any(String));
    // `—` in design.md's column: nothing to fall back to even where the
    // capability is missing.
    expect(substituteOf('slack', 'ephemeralMessage')).toBeNull();
  });

  it("reports slashCommand as none for every service, Requirement 1.3's stated value (task 12.2)", () => {
    // command/invocation.ts does not yet strip the leading `/` a real Slack or
    // Discord slash-command event carries, so no registered command name ever
    // matches one -- reporting `full` here would tell an operator this works
    // when it does not (task 10.1's finding, closed by task 12.2).
    const report = buildCapabilityReport();
    const levelOf = (platform: PlatformName) =>
      report.platforms
        .find((entry) => entry.platform === platform)
        ?.capabilities.find((row) => row.capability === 'slashCommand')?.level;

    expect(levelOf('slack')).toBe('none');
    expect(levelOf('discord')).toBe('none');
  });
});
