// The op vocabulary shared by both sides of the integration, the base type
// every signed body extends, and the endpoint each op is served on.

/**
 * Which op was called. **The value goes in the body, so `content-digest`
 * covers it** -- the signature deliberately covers neither the target URL nor
 * the path, because a reverse proxy rewrites both and every request from a
 * legitimate peer would then fail verification. `op` is a value both sides
 * hold as data, so no intermediary can change what it says.
 *
 * **The direction is part of the name.** Key registration and revocation flow
 * proxy -> GROWI as well as GROWI -> proxy, so a shared name would leave
 * `acceptEnvelope` unable to tell the two apart and its comparison would stop
 * being unique (Requirement 10.1).
 */
export const OP_NAMES = {
  // proxy -> GROWI
  command: 'command',
  accountLinkStart: 'account-link-start',
  settingsPull: 'settings-pull',
  keyRegisterToGrowi: 'key-register-to-growi',
  keyRevokeToGrowi: 'key-revoke-to-growi',
  // GROWI -> proxy
  notification: 'notification',
  settingsPush: 'settings-push',
  keyRegisterToProxy: 'key-register-to-proxy',
  keyRevokeToProxy: 'key-revoke-to-proxy',
  capabilities: 'capabilities',
  connectionStatus: 'connection-status',
  channels: 'channels',
} as const;

export type OpName = (typeof OP_NAMES)[keyof typeof OP_NAMES];

/**
 * **Every signed body extends this.** `op` is the single constraint that
 * replaced the target URL and the path in the signature's coverage, so it is
 * held as a type rather than as prose. Left to prose, a hand-written check
 * function silently drops `op`, and whether the comparison quietly matches
 * nothing or every request comes back `malformed` is decided by how the
 * implementer happened to write it (Requirement 10.1).
 */
export interface RequestEnvelope {
  readonly relationId: string;
  readonly op: OpName;
}

/** The body of a read-only op, and of `settings-pull`, is the envelope itself. */
export interface OpOnlyRequest extends RequestEnvelope {
  readonly op:
    | typeof OP_NAMES.capabilities
    | typeof OP_NAMES.connectionStatus
    | typeof OP_NAMES.channels
    | typeof OP_NAMES.settingsPull;
}

/** Which side sends the request; the other side serves the endpoint. */
export type OpDirection = 'proxy-to-growi' | 'growi-to-proxy';

export interface OpEndpointDescriptor {
  readonly op: OpName;
  readonly direction: OpDirection;
  /**
   * **A string appended to the peer's base URL**, with `{growiUri}` or
   * `{proxyUri}` standing for that base. Recording it as a bare relative path
   * would hide that GROWI serves its ops below `/_api/v3/` while the proxy
   * serves them at the root, and the joined URL would 404. Both base URLs are
   * the values the two sides stored during pairing.
   */
  readonly pathTemplate: string;
  /**
   * Name of the body type this op carries. Recorded as a name, not as a type
   * reference: the body types are declared by later tasks, and this table has
   * to be complete before them.
   */
  readonly bodyTypeName: string;
  /**
   * Requirement or acceptance-criteria numbers, exactly as design.md's op
   * table records them: some rows name a whole requirement (`'3'`), others a
   * single acceptance criterion (`'7.3'`).
   */
  readonly requirementIds: ReadonlyArray<string>;
}

/**
 * **This table is this spec's own property**; proxy and app each align their
 * own side to it. `Record<OpName, OpEndpointDescriptor>` is what enforces
 * that: an op added to `OP_NAMES` without an endpoint here cannot compile, so
 * the vocabulary and the routing can never drift apart.
 *
 * The two unsigned entry points -- pairing submission and the ownership
 * challenge -- are deliberately absent. Both run before any key exists, so
 * they carry no `relationId`, no `op`, and no signature.
 */
export const OP_ENDPOINTS: Readonly<Record<OpName, OpEndpointDescriptor>> = {
  [OP_NAMES.command]: {
    op: OP_NAMES.command,
    direction: 'proxy-to-growi',
    pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/command',
    bodyTypeName: 'CommandRequest',
    requirementIds: ['3', '4', '5', '6', '14'],
  },
  [OP_NAMES.accountLinkStart]: {
    op: OP_NAMES.accountLinkStart,
    direction: 'proxy-to-growi',
    pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/account-link/start',
    bodyTypeName: 'AccountLinkStartRequest',
    requirementIds: ['7.3'],
  },
  [OP_NAMES.settingsPull]: {
    op: OP_NAMES.settingsPull,
    direction: 'proxy-to-growi',
    pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/settings',
    bodyTypeName: 'OpOnlyRequest',
    requirementIds: ['11.1'],
  },
  [OP_NAMES.keyRegisterToGrowi]: {
    op: OP_NAMES.keyRegisterToGrowi,
    direction: 'proxy-to-growi',
    pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/keys/register',
    bodyTypeName: 'KeyRegistrationRequest',
    requirementIds: ['10.5'],
  },
  [OP_NAMES.keyRevokeToGrowi]: {
    op: OP_NAMES.keyRevokeToGrowi,
    direction: 'proxy-to-growi',
    pathTemplate: '{growiUri}/_api/v3/chat-integration/peer/keys/revoke',
    bodyTypeName: 'KeyRevocationRequest',
    requirementIds: ['10.5'],
  },
  [OP_NAMES.notification]: {
    op: OP_NAMES.notification,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/notification',
    bodyTypeName: 'NotificationRequest',
    requirementIds: ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6'],
  },
  [OP_NAMES.settingsPush]: {
    op: OP_NAMES.settingsPush,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/settings-push',
    bodyTypeName: 'SettingsPushRequest',
    requirementIds: ['11.1', '11.2', '11.4'],
  },
  [OP_NAMES.keyRegisterToProxy]: {
    op: OP_NAMES.keyRegisterToProxy,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/keys/register',
    bodyTypeName: 'KeyRegistrationRequest',
    requirementIds: ['10.5'],
  },
  [OP_NAMES.keyRevokeToProxy]: {
    op: OP_NAMES.keyRevokeToProxy,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/keys/revoke',
    bodyTypeName: 'KeyRevocationRequest',
    requirementIds: ['10.5'],
  },
  [OP_NAMES.capabilities]: {
    op: OP_NAMES.capabilities,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/capabilities',
    bodyTypeName: 'OpOnlyRequest',
    requirementIds: ['1.3'],
  },
  [OP_NAMES.connectionStatus]: {
    op: OP_NAMES.connectionStatus,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/connection-status',
    bodyTypeName: 'OpOnlyRequest',
    requirementIds: ['1.4'],
  },
  [OP_NAMES.channels]: {
    op: OP_NAMES.channels,
    direction: 'growi-to-proxy',
    pathTemplate: '{proxyUri}/chat-integration/channels',
    bodyTypeName: 'OpOnlyRequest',
    requirementIds: ['2.2', '11.1'],
  },
};
