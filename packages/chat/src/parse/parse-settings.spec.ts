import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import { parseAccountLinkStart, parseSettingsPush } from './parse-settings.js';

describe('parseSettingsPush', () => {
  const valid = {
    relationId: 'rel-1',
    op: 'settings-push',
    settings: {
      relationId: 'rel-1',
      channelPermissions: [
        { commandName: 'search', allowedChannels: 'all' as const },
        { commandName: 'create-page', allowedChannels: ['C1', 'C2'] },
      ],
    },
    version: 3,
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseSettingsPush(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid request and retains relationId/op', () => {
    const result = parseSettingsPush(valid);
    expect(result).toEqual(valid);
    if (!('error' in result)) {
      expect(result.relationId).toBe('rel-1');
      expect(result.op).toBe('settings-push');
    }
  });

  it('accepts "none" as allowedChannels', () => {
    const withNone = {
      ...valid,
      settings: {
        ...valid.settings,
        channelPermissions: [
          { commandName: 'search', allowedChannels: 'none' as const },
        ],
      },
    };
    expect(parseSettingsPush(withNone)).toEqual(withNone);
  });

  it('accepts version 0', () => {
    expect(parseSettingsPush({ ...valid, version: 0 })).toEqual({
      ...valid,
      version: 0,
    });
  });

  it.each([
    'relationId',
    'settings',
    'version',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseSettingsPush(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects when op is missing', () => {
    const { op: _omit, ...rest } = valid;
    expect(parseSettingsPush(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an op that is not a real OP_NAMES member', () => {
    expect(parseSettingsPush({ ...valid, op: 'nope' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that IS a real OP_NAMES member but not allowed for this endpoint', () => {
    expect(parseSettingsPush({ ...valid, op: 'command' })).toEqual({
      error: 'malformed',
    });
  });

  it.each(
    Object.values(OP_NAMES).filter((op) => op !== OP_NAMES.settingsPush),
  )('rejects every other real OP_NAMES member: %s', (op) => {
    expect(parseSettingsPush({ ...valid, op })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a negative version', () => {
    expect(parseSettingsPush({ ...valid, version: -1 })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a non-integer version', () => {
    expect(parseSettingsPush({ ...valid, version: 1.5 })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects settings missing its nested relationId', () => {
    const { relationId: _omit, ...restSettings } = valid.settings;
    expect(parseSettingsPush({ ...valid, settings: restSettings })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a channelPermissions row with an unrecognized commandName', () => {
    expect(
      parseSettingsPush({
        ...valid,
        settings: {
          ...valid.settings,
          channelPermissions: [{ commandName: 'nuke', allowedChannels: 'all' }],
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a channelPermissions row with an invalid allowedChannels value', () => {
    expect(
      parseSettingsPush({
        ...valid,
        settings: {
          ...valid.settings,
          channelPermissions: [
            { commandName: 'search', allowedChannels: 'everything' },
          ],
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized channelPermissions array', () => {
    const many = Array.from({ length: 51 }, () => ({
      commandName: 'search',
      allowedChannels: 'all' as const,
    }));
    expect(
      parseSettingsPush({
        ...valid,
        settings: { ...valid.settings, channelPermissions: many },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized allowedChannels array', () => {
    const many = Array.from({ length: 1001 }, (_v, i) => `C${i}`);
    expect(
      parseSettingsPush({
        ...valid,
        settings: {
          ...valid.settings,
          channelPermissions: [
            { commandName: 'search', allowedChannels: many },
          ],
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a channelPermissions array containing a non-object element', () => {
    expect(
      parseSettingsPush({
        ...valid,
        settings: { ...valid.settings, channelPermissions: [42] },
      }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseAccountLinkStart', () => {
  const valid = {
    relationId: 'rel-1',
    op: 'account-link-start',
    actor: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseAccountLinkStart(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid request and retains relationId/op', () => {
    const result = parseAccountLinkStart(valid);
    expect(result).toEqual(valid);
    if (!('error' in result)) {
      expect(result.relationId).toBe('rel-1');
      expect(result.op).toBe('account-link-start');
    }
  });

  it.each([
    'relationId',
    'actor',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseAccountLinkStart(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects when op is missing', () => {
    const { op: _omit, ...rest } = valid;
    expect(parseAccountLinkStart(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an op that is not a real OP_NAMES member', () => {
    expect(parseAccountLinkStart({ ...valid, op: 'nope' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that IS a real OP_NAMES member but not allowed for this endpoint', () => {
    expect(parseAccountLinkStart({ ...valid, op: 'command' })).toEqual({
      error: 'malformed',
    });
  });

  it.each(
    Object.values(OP_NAMES).filter((op) => op !== OP_NAMES.accountLinkStart),
  )('rejects every other real OP_NAMES member: %s', (op) => {
    expect(parseAccountLinkStart({ ...valid, op })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a wrong-typed actor', () => {
    expect(parseAccountLinkStart({ ...valid, actor: 'Alice' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an actor missing a required sub-field', () => {
    const { displayName: _omit, ...restActor } = valid.actor;
    expect(parseAccountLinkStart({ ...valid, actor: restActor })).toEqual({
      error: 'malformed',
    });
  });
});
