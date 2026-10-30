import { describe, expect, it } from 'vitest';

import {
  OP_ENDPOINTS,
  OP_NAMES,
  type OpEndpointDescriptor,
  type OpOnlyRequest,
  type RequestEnvelope,
} from './op-names';

describe('op vocabulary', () => {
  it('spells every op exactly as both sides send/match it, with the direction in the name', () => {
    // Both sides read these literals from here: the sender puts the value in
    // the body and the receiver compares it against the op it serves. A
    // spelling drift makes every request `malformed` (Requirement 10.1).
    // Key registration and revocation flow in BOTH directions, so the name
    // carries the direction -- otherwise `acceptEnvelope` cannot tell the two
    // apart and the comparison stops being unique.
    expect(OP_NAMES).toEqual({
      command: 'command',
      accountLinkStart: 'account-link-start',
      settingsPull: 'settings-pull',
      keyRegisterToGrowi: 'key-register-to-growi',
      keyRevokeToGrowi: 'key-revoke-to-growi',
      notification: 'notification',
      settingsPush: 'settings-push',
      keyRegisterToProxy: 'key-register-to-proxy',
      keyRevokeToProxy: 'key-revoke-to-proxy',
      capabilities: 'capabilities',
      connectionStatus: 'connection-status',
      channels: 'channels',
    });
  });

  it('gives the two directions of key registration and revocation distinct names', () => {
    expect(OP_NAMES.keyRegisterToGrowi).not.toBe(OP_NAMES.keyRegisterToProxy);
    expect(OP_NAMES.keyRevokeToGrowi).not.toBe(OP_NAMES.keyRevokeToProxy);
  });
});

describe('signed request envelope', () => {
  // These two cases are compile-time canaries rather than runtime checks: they
  // build a literal of the type and cannot fail at run time. What they catch is
  // a change to the type -- a third required field, a renamed field, or a
  // narrowing that makes `OpOnlyRequest` stop being assignable to the base type
  // -- which stops the file from typechecking. `op` is the only constraint left
  // after the target URL and the path were taken out of the signature's
  // coverage, so the shape is worth pinning (Requirement 10.1).
  it('carries the relation identifier and the op, the only two fields signing relies on', () => {
    const envelope: RequestEnvelope = {
      relationId: 'rel-1',
      op: OP_NAMES.command,
    };
    expect(Object.keys(envelope).sort()).toEqual(['op', 'relationId']);
  });

  it('lets a read-only op body be the envelope itself', () => {
    const body: OpOnlyRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.capabilities,
    };
    // `OpOnlyRequest` narrows `op`, so it stays assignable to the base type
    // the signer accepts.
    const asEnvelope: RequestEnvelope = body;
    expect(asEnvelope.op).toBe('capabilities');
  });
});

describe('op endpoint table', () => {
  it('declares an endpoint for every op, with no extra entries', () => {
    // `Record<OpName, OpEndpointDescriptor>` makes a missing entry a compile
    // error; this assertion is the guard that survives the probe's removal.
    expect(Object.keys(OP_ENDPOINTS).sort()).toEqual(
      [...Object.values(OP_NAMES)].sort(),
    );
  });

  it('keys each entry by its own op', () => {
    for (const [key, descriptor] of Object.entries(OP_ENDPOINTS)) {
      expect(descriptor.op).toBe(key);
    }
  });

  // The design's table is this spec's own property; proxy and app each align
  // their side to it. Restated here so a drift in any column fails, with one
  // deliberate normalization: design.md writes notification's requirements as
  // the range `2.1-2.6`, which is spelled out entry by entry.
  const table: readonly OpEndpointDescriptor[] = [
    {
      op: OP_NAMES.command,
      direction: 'proxy-to-growi',
      pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/command',
      bodyTypeName: 'CommandRequest',
      requirementIds: ['3', '4', '5', '6', '14'],
    },
    {
      op: OP_NAMES.accountLinkStart,
      direction: 'proxy-to-growi',
      pathTemplate:
        '{growiUri}/_api/v3/chat-integration/peer/account-link/start',
      bodyTypeName: 'AccountLinkStartRequest',
      requirementIds: ['7.3'],
    },
    {
      op: OP_NAMES.settingsPull,
      direction: 'proxy-to-growi',
      pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/settings',
      bodyTypeName: 'OpOnlyRequest',
      requirementIds: ['11.1'],
    },
    {
      op: OP_NAMES.keyRegisterToGrowi,
      direction: 'proxy-to-growi',
      pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/keys/register',
      bodyTypeName: 'KeyRegistrationRequest',
      requirementIds: ['10.5'],
    },
    {
      op: OP_NAMES.keyRevokeToGrowi,
      direction: 'proxy-to-growi',
      pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/keys/revoke',
      bodyTypeName: 'KeyRevocationRequest',
      requirementIds: ['10.5'],
    },
    {
      op: OP_NAMES.notification,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/notification',
      bodyTypeName: 'NotificationRequest',
      requirementIds: ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6'],
    },
    {
      op: OP_NAMES.settingsPush,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/settings-push',
      bodyTypeName: 'SettingsPushRequest',
      requirementIds: ['11.1', '11.2', '11.4'],
    },
    {
      op: OP_NAMES.keyRegisterToProxy,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/keys/register',
      bodyTypeName: 'KeyRegistrationRequest',
      requirementIds: ['10.5'],
    },
    {
      op: OP_NAMES.keyRevokeToProxy,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/keys/revoke',
      bodyTypeName: 'KeyRevocationRequest',
      requirementIds: ['10.5'],
    },
    {
      op: OP_NAMES.capabilities,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/capabilities',
      bodyTypeName: 'OpOnlyRequest',
      requirementIds: ['1.3'],
    },
    {
      op: OP_NAMES.connectionStatus,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/connection-status',
      bodyTypeName: 'OpOnlyRequest',
      requirementIds: ['1.4'],
    },
    {
      op: OP_NAMES.channels,
      direction: 'growi-to-proxy',
      pathTemplate: '{proxyUri}/chat-integration/channels',
      bodyTypeName: 'OpOnlyRequest',
      requirementIds: ['2.2', '11.1'],
    },
  ];

  it('copies every row of the design table, and only those rows', () => {
    expect(table.map((row) => row.op).sort()).toEqual(
      [...Object.values(OP_NAMES)].sort(),
    );
  });

  it.each(
    table,
  )('$op: $direction $pathTemplate ($bodyTypeName)', (expected) => {
    expect(OP_ENDPOINTS[expected.op]).toEqual(expected);
  });

  it('joins every path onto the peer base URL, never as a bare relative path', () => {
    // The table's paths are strings appended to the peer's base URL. Writing
    // them relative would hide that GROWI serves its ops under `/_api/v3/`
    // while the proxy serves them at the root -- the joined URL would 404.
    for (const { direction, pathTemplate } of Object.values(OP_ENDPOINTS)) {
      const placeholder =
        direction === 'proxy-to-growi' ? '{growiUri}' : '{proxyUri}';
      expect(pathTemplate.startsWith(`${placeholder}/`)).toBe(true);
    }
  });

  it('serves every GROWI-side op under /peer/ so raw-byte handling stays off the admin API', () => {
    // Signature verification needs the bytes exactly as they arrived, and
    // that handling must not reach the admin screen's ordinary JSON APIs.
    const growiSide = Object.values(OP_ENDPOINTS).filter(
      (d) => d.direction === 'proxy-to-growi',
    );
    expect(growiSide).not.toHaveLength(0);
    for (const { pathTemplate } of growiSide) {
      expect(pathTemplate).toContain('/_api/v3/chat-integration/peer/');
    }
  });

  it('excludes the two unsigned entry points, which carry no envelope', () => {
    // Pairing submission and the ownership challenge run before any key
    // exists, so they carry no `relationId` and no signature -- the design
    // keeps them outside this table on purpose.
    const paths = Object.values(OP_ENDPOINTS).map((d) => d.pathTemplate);
    expect(paths).not.toContain('{proxyUri}/chat-integration/pairing/submit');
    expect(paths).not.toContain(
      '{growiUri}/_api/v3/chat-integration/peer/pairing/challenge',
    );
  });
});
