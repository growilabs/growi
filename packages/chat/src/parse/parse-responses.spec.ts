import { describe, expect, it } from 'vitest';

import {
  parseAccountLinkStartResponse,
  parseCapabilityReport,
  parseChannelInventory,
  parseConnectionStatusView,
  parseKeyOperationResult,
  parsePairingResult,
  parseSettingsPullResponse,
} from './parse-responses.js';

const validJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'base64url-public-component',
};

const validPublicKey = {
  keyId: 'abcdefgh12345678',
  publicKeyJwk: validJwk,
  validFrom: '2026-01-01T00:00:00.000Z',
};

describe('parseKeyOperationResult', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseKeyOperationResult(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid ok result', () => {
    expect(parseKeyOperationResult({ status: 'ok' })).toEqual({
      status: 'ok',
    });
  });

  it.each([
    'would-leave-no-valid-key',
    'unknown-key',
    'invalid-key',
  ])('accepts every real rejection reason: %s', (reason) => {
    expect(parseKeyOperationResult({ status: 'rejected', reason })).toEqual({
      status: 'rejected',
      reason,
    });
  });

  it('rejects when status is missing', () => {
    expect(parseKeyOperationResult({})).toEqual({ error: 'malformed' });
  });

  it('rejects an unrecognized status value', () => {
    expect(parseKeyOperationResult({ status: 'maybe' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a rejected result missing reason', () => {
    expect(parseKeyOperationResult({ status: 'rejected' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a rejected result with an unrecognized reason', () => {
    expect(
      parseKeyOperationResult({ status: 'rejected', reason: 'no-idea' }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseAccountLinkStartResponse', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseAccountLinkStartResponse(value)).toEqual({
        error: 'malformed',
      });
    });
  });

  it('accepts a valid link-issued response', () => {
    const valid = {
      status: 'link-issued',
      linkUrl: 'https://growi.example.com/link/abc',
      expiresAt: '2026-01-01T00:00:00.000Z',
    };
    expect(parseAccountLinkStartResponse(valid)).toEqual(valid);
  });

  it('accepts a valid already-linked response', () => {
    const valid = { status: 'already-linked', growiUserName: 'alice' };
    expect(parseAccountLinkStartResponse(valid)).toEqual(valid);
  });

  it('accepts a valid taken-by-another-user response', () => {
    const valid = { status: 'taken-by-another-user' };
    expect(parseAccountLinkStartResponse(valid)).toEqual(valid);
  });

  it.each([
    'link-issued',
    'already-linked',
    'taken-by-another-user',
  ])('accepts every real status value: %s', (status) => {
    const byStatus: Record<string, unknown> = {
      'link-issued': {
        status,
        linkUrl: 'https://growi.example.com/link/abc',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
      'already-linked': { status, growiUserName: 'alice' },
      'taken-by-another-user': { status },
    };
    expect(parseAccountLinkStartResponse(byStatus[status])).not.toEqual({
      error: 'malformed',
    });
  });

  it.each([
    'nope',
    'link-pending',
    '',
  ])('rejects every unknown status value: %s', (status) => {
    expect(parseAccountLinkStartResponse({ status })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects when status is missing', () => {
    expect(parseAccountLinkStartResponse({})).toEqual({ error: 'malformed' });
  });

  it.each([
    'linkUrl',
    'expiresAt',
  ] as const)('rejects a link-issued response missing %s', (field) => {
    const valid = {
      status: 'link-issued',
      linkUrl: 'https://growi.example.com/link/abc',
      expiresAt: '2026-01-01T00:00:00.000Z',
    };
    const { [field]: _omit, ...rest } = valid;
    expect(parseAccountLinkStartResponse(rest)).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an already-linked response missing growiUserName', () => {
    expect(parseAccountLinkStartResponse({ status: 'already-linked' })).toEqual(
      {
        error: 'malformed',
      },
    );
  });

  it('rejects a wrong-typed linkUrl', () => {
    expect(
      parseAccountLinkStartResponse({
        status: 'link-issued',
        linkUrl: 42,
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseSettingsPullResponse', () => {
  const validSettings = {
    relationId: 'rel-1',
    channelPermissions: [
      { commandName: 'search', allowedChannels: 'all' as const },
    ],
  };

  const valid = { settings: validSettings, version: 3 };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseSettingsPullResponse(value)).toEqual({
        error: 'malformed',
      });
    });
  });

  it('accepts a valid response', () => {
    expect(parseSettingsPullResponse(valid)).toEqual(valid);
  });

  it('accepts version 0', () => {
    expect(parseSettingsPullResponse({ ...valid, version: 0 })).toEqual({
      ...valid,
      version: 0,
    });
  });

  it.each([
    'settings',
    'version',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseSettingsPullResponse(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects a negative version', () => {
    expect(parseSettingsPullResponse({ ...valid, version: -1 })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a non-integer version', () => {
    expect(parseSettingsPullResponse({ ...valid, version: 1.5 })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects settings missing its nested relationId', () => {
    const { relationId: _omit, ...restSettings } = validSettings;
    expect(
      parseSettingsPullResponse({ ...valid, settings: restSettings }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a channelPermissions row with an unrecognized commandName', () => {
    expect(
      parseSettingsPullResponse({
        settings: {
          ...validSettings,
          channelPermissions: [{ commandName: 'nuke', allowedChannels: 'all' }],
        },
        version: 3,
      }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parsePairingResult', () => {
  const validPaired = {
    status: 'paired',
    relationId: 'rel-1',
    workspace: {
      platform: 'slack',
      workspaceId: 'W1',
      workspaceName: 'Acme Corp',
    },
    publicKey: validPublicKey,
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parsePairingResult(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid paired result', () => {
    expect(parsePairingResult(validPaired)).toEqual(validPaired);
  });

  it('accepts a valid code-expired result', () => {
    expect(parsePairingResult({ status: 'code-expired' })).toEqual({
      status: 'code-expired',
    });
  });

  it('accepts a valid ownership-unverified result', () => {
    const valid = {
      status: 'ownership-unverified',
      detail: 'signature mismatch',
    };
    expect(parsePairingResult(valid)).toEqual(valid);
  });

  it('accepts a valid already-paired result', () => {
    const valid = { status: 'already-paired', detail: 'relation exists' };
    expect(parsePairingResult(valid)).toEqual(valid);
  });

  it.each([
    'paired',
    'code-expired',
    'ownership-unverified',
    'already-paired',
  ])('accepts every real status value: %s', (status) => {
    const byStatus: Record<string, unknown> = {
      paired: validPaired,
      'code-expired': { status },
      'ownership-unverified': { status, detail: 'x' },
      'already-paired': { status, detail: 'x' },
    };
    expect(parsePairingResult(byStatus[status])).not.toEqual({
      error: 'malformed',
    });
  });

  it.each([
    'nope',
    'pairing-pending',
    '',
  ])('rejects every unknown status value: %s', (status) => {
    expect(parsePairingResult({ status })).toEqual({ error: 'malformed' });
  });

  it('rejects when status is missing', () => {
    expect(parsePairingResult({})).toEqual({ error: 'malformed' });
  });

  it.each([
    'relationId',
    'workspace',
    'publicKey',
  ] as const)('rejects a paired result missing %s', (field) => {
    const { [field]: _omit, ...rest } = validPaired;
    expect(parsePairingResult(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects a paired result whose workspace.workspaceId is missing', () => {
    const { workspaceId: _omit, ...restWorkspace } = validPaired.workspace;
    expect(
      parsePairingResult({ ...validPaired, workspace: restWorkspace }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a paired result whose workspace.platform is unrecognized', () => {
    expect(
      parsePairingResult({
        ...validPaired,
        workspace: { ...validPaired.workspace, platform: 'irc' },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a paired result whose publicKey.keyId fails isValidKeyIdShape', () => {
    expect(
      parsePairingResult({
        ...validPaired,
        publicKey: { ...validPublicKey, keyId: 'short' },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a paired result whose publicKey.publicKeyJwk fails isValidPublicKeyMaterial (wrong kty)', () => {
    expect(
      parsePairingResult({
        ...validPaired,
        publicKey: {
          ...validPublicKey,
          publicKeyJwk: { ...validJwk, kty: 'RSA' },
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a paired result whose publicKey.publicKeyJwk carries a secret component', () => {
    expect(
      parsePairingResult({
        ...validPaired,
        publicKey: {
          ...validPublicKey,
          publicKeyJwk: { ...validJwk, d: 'secret' },
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an ownership-unverified result missing detail', () => {
    expect(parsePairingResult({ status: 'ownership-unverified' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an already-paired result missing detail', () => {
    expect(parsePairingResult({ status: 'already-paired' })).toEqual({
      error: 'malformed',
    });
  });
});

describe('parseCapabilityReport', () => {
  const valid = {
    platforms: [
      {
        platform: 'slack',
        capabilities: [
          {
            capability: 'thread-reply',
            level: 'full' as const,
            substitute: null,
          },
          {
            capability: 'ephemeral-message',
            level: 'degraded' as const,
            substitute: 'visible message',
          },
        ],
      },
    ],
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseCapabilityReport(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid report', () => {
    expect(parseCapabilityReport(valid)).toEqual(valid);
  });

  it('accepts an empty platforms array', () => {
    expect(parseCapabilityReport({ platforms: [] })).toEqual({
      platforms: [],
    });
  });

  it.each([
    'full',
    'degraded',
    'none',
    'unverified',
  ])('accepts every real CapabilityLevel value: %s', (level) => {
    const withLevel = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [{ capability: 'x', level, substitute: null }],
        },
      ],
    };
    expect(parseCapabilityReport(withLevel)).toEqual(withLevel);
  });

  it.each([
    'nope',
    'partial',
    '',
  ])('rejects every unknown CapabilityLevel value: %s', (level) => {
    const withLevel = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [{ capability: 'x', level, substitute: null }],
        },
      ],
    };
    expect(parseCapabilityReport(withLevel)).toEqual({ error: 'malformed' });
  });

  it('accepts substitute: null', () => {
    const withNull = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [
            { capability: 'x', level: 'none' as const, substitute: null },
          ],
        },
      ],
    };
    expect(parseCapabilityReport(withNull)).toEqual(withNull);
  });

  it('accepts substitute as a real string', () => {
    const withString = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [
            {
              capability: 'x',
              level: 'degraded' as const,
              substitute: 'fallback',
            },
          ],
        },
      ],
    };
    expect(parseCapabilityReport(withString)).toEqual(withString);
  });

  it('rejects a missing substitute key (not the same as explicit null)', () => {
    const withoutKey = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [{ capability: 'x', level: 'full' }],
        },
      ],
    };
    expect(parseCapabilityReport(withoutKey)).toEqual({ error: 'malformed' });
  });

  it('rejects substitute: undefined explicitly (not the same as explicit null)', () => {
    const withUndefined = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [
            { capability: 'x', level: 'full', substitute: undefined },
          ],
        },
      ],
    };
    expect(parseCapabilityReport(withUndefined)).toEqual({
      error: 'malformed',
    });
  });

  it.each([
    42,
    {},
    [],
  ])('rejects a non-null-non-string substitute: %p', (substitute) => {
    const withBad = {
      platforms: [
        {
          platform: 'slack',
          capabilities: [{ capability: 'x', level: 'full', substitute }],
        },
      ],
    };
    expect(parseCapabilityReport(withBad)).toEqual({ error: 'malformed' });
  });

  it('rejects the whole platforms array when a MIDDLE element is malformed', () => {
    const goodPlatform = {
      platform: 'slack',
      capabilities: [
        { capability: 'x', level: 'full' as const, substitute: null },
      ],
    };
    const badPlatform = { platform: 'irc', capabilities: [] };
    expect(
      parseCapabilityReport({
        platforms: [goodPlatform, badPlatform, goodPlatform],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects the whole capabilities array when a MIDDLE element is malformed', () => {
    const goodCap = {
      capability: 'x',
      level: 'full' as const,
      substitute: null,
    };
    const badCap = { capability: 'y', level: 'not-a-level', substitute: null };
    expect(
      parseCapabilityReport({
        platforms: [
          { platform: 'slack', capabilities: [goodCap, badCap, goodCap] },
        ],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an unrecognized platform', () => {
    expect(
      parseCapabilityReport({
        platforms: [{ platform: 'irc', capabilities: [] }],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects when platforms is missing', () => {
    expect(parseCapabilityReport({})).toEqual({ error: 'malformed' });
  });

  it('rejects a platforms array containing a non-object element', () => {
    expect(parseCapabilityReport({ platforms: [42] })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a capabilities array containing a non-object element', () => {
    expect(
      parseCapabilityReport({
        platforms: [{ platform: 'slack', capabilities: [42] }],
      }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseChannelInventory', () => {
  const valid = {
    channels: [
      {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      {
        platform: 'discord',
        channelId: 'C2',
        channelName: 'random',
        isPrivate: true,
      },
    ],
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseChannelInventory(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid inventory', () => {
    expect(parseChannelInventory(valid)).toEqual(valid);
  });

  it('accepts an empty channels array', () => {
    expect(parseChannelInventory({ channels: [] })).toEqual({ channels: [] });
  });

  it('rejects when channels is missing', () => {
    expect(parseChannelInventory({})).toEqual({ error: 'malformed' });
  });

  it('rejects a non-boolean isPrivate deep in a channel element', () => {
    const bad = {
      channels: [{ ...valid.channels[0], isPrivate: 'false' }],
    };
    expect(parseChannelInventory(bad)).toEqual({ error: 'malformed' });
  });

  it('rejects the whole channels array when a MIDDLE element is malformed', () => {
    const good = valid.channels[0];
    const bad = { ...valid.channels[1], channelId: undefined };
    expect(parseChannelInventory({ channels: [good, bad, good] })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an unrecognized platform in a channel element', () => {
    expect(
      parseChannelInventory({
        channels: [{ ...valid.channels[0], platform: 'irc' }],
      }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseConnectionStatusView', () => {
  const valid = {
    platform: 'slack',
    health: 'connected' as const,
    since: '2026-01-01T00:00:00.000Z',
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseConnectionStatusView(value)).toEqual({
        error: 'malformed',
      });
    });
  });

  it('accepts a valid view', () => {
    expect(parseConnectionStatusView(valid)).toEqual(valid);
  });

  it.each([
    'connected',
    'reconnecting',
    'failed',
    'not-applicable',
  ])('accepts every real ConnectionHealth value: %s', (health) => {
    expect(parseConnectionStatusView({ ...valid, health })).toEqual({
      ...valid,
      health,
    });
  });

  it.each([
    'nope',
    'disconnected',
    '',
  ])('rejects every unknown ConnectionHealth value: %s', (health) => {
    expect(parseConnectionStatusView({ ...valid, health })).toEqual({
      error: 'malformed',
    });
  });

  it.each([
    'platform',
    'health',
    'since',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseConnectionStatusView(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an unrecognized platform', () => {
    expect(parseConnectionStatusView({ ...valid, platform: 'irc' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an oversized since value', () => {
    expect(
      parseConnectionStatusView({ ...valid, since: 'x'.repeat(1000) }),
    ).toEqual({ error: 'malformed' });
  });
});
