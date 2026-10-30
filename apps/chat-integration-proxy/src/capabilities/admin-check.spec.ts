import type { PlatformName } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import { ADMIN_CHECK_TABLE } from './admin-check.js';

const ALL_PLATFORMS: readonly PlatformName[] = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

describe('ADMIN_CHECK_TABLE', () => {
  it('declares an admin-check method for every service, as data -- not a platform branch', () => {
    for (const platform of ALL_PLATFORMS) {
      const method = ADMIN_CHECK_TABLE[platform];
      expect(method).toBeDefined();
      expect(method.fields.length).toBeGreaterThan(0);
    }
  });

  it('matches design.md field names per service', () => {
    expect(ADMIN_CHECK_TABLE.slack.fields).toEqual(['is_admin', 'is_owner']);
    expect(ADMIN_CHECK_TABLE.discord.fields).toEqual([
      'ADMINISTRATOR',
      'MANAGE_GUILD',
    ]);
    expect(ADMIN_CHECK_TABLE.mattermost.fields).toEqual([
      'system_admin',
      'team_admin',
    ]);
    expect(ADMIN_CHECK_TABLE.teams.fields).toEqual(['owner']);
  });
});
