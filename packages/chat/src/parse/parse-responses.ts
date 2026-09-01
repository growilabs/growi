// Response-side shape parsers whose validated value gets written straight
// into persisted state (design.md's callout box above the parse*
// signatures: "受け取るものは、要求も応答も、使う前に必ず検査関数を通す" --
// a response carries no signature, so the shape check here is the ONLY
// acceptance gate, not a secondary one layered on top of signature
// verification). design.md's File Structure Plan comments this file as
// holding all 7 of the package's response-side parsers; task 6.4 adds the
// first one (`parseKeyOperationResult`), and task 6.5 adds the remaining 6
// into this same file afterward.

import type { AccountLinkStartResponse } from '../contract/account-link.js';
import type { KeyOperationResult, PairingResult } from '../contract/pairing.js';
import type {
  CapabilityReport,
  ChannelInventory,
  ConnectionHealth,
  ConnectionStatusView,
  SettingsPullResponse,
} from '../contract/settings.js';
import {
  PLATFORM_NAMES,
  parseChannelRef,
  parsePublicKeyRegistration,
} from './common-fields.js';
import { parseRelationSettings, parseVersion } from './parse-settings.js';
import { arr, isRecord, oneOf, str } from './shape.js';

const STATUS_VALUES = ['ok', 'rejected'] as const;
const REJECTION_REASONS = [
  'would-leave-no-valid-key',
  'unknown-key',
  'invalid-key',
] as const;

type ParseError = { readonly error: 'malformed' };

/**
 * Confirms the wire shape of `KeyOperationResult` (Requirement 10.5/10.6's
 * key add/revoke round trip). A malformed value here does not just fail
 * one request -- whichever side calls this treats the parsed result as
 * whether a key rotation is complete, so an unchecked value can corrupt
 * that bookkeeping in a way nobody can trace back to the cause later
 * (design.md's rationale for this whole file).
 */
export const parseKeyOperationResult = (
  raw: unknown,
): KeyOperationResult | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const status = oneOf(raw.status, STATUS_VALUES);
  if (status === undefined) {
    return { error: 'malformed' };
  }

  if (status === 'ok') {
    return { status: 'ok' };
  }

  const reason = oneOf(raw.reason, REJECTION_REASONS);
  if (reason === undefined) {
    return { error: 'malformed' };
  }

  return { status: 'rejected', reason };
};

/** A one-time, short-lived link URL an ephemeral chat message shows the user (Req 7.3). */
const LINK_URL_MAX = 2048;
/** ISO-8601 timestamp (`Date#toISOString()`, see tasks.md's 4.3 Implementation Note). */
const EXPIRES_AT_MAX = 64;
const GROWI_USER_NAME_MAX = 200;

const ACCOUNT_LINK_STATUS_VALUES = [
  'link-issued',
  'already-linked',
  'taken-by-another-user',
] as const;

/**
 * Confirms the wire shape of `AccountLinkStartResponse` (Requirement 7).
 * A malformed `link-issued` variant that still gets shown to a user hands
 * out a broken link with no way to trace which request produced it, per
 * design.md's rationale for this whole file.
 */
export const parseAccountLinkStartResponse = (
  raw: unknown,
): AccountLinkStartResponse | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const status = oneOf(raw.status, ACCOUNT_LINK_STATUS_VALUES);
  if (status === undefined) {
    return { error: 'malformed' };
  }

  if (status === 'taken-by-another-user') {
    return { status };
  }

  if (status === 'already-linked') {
    const growiUserName = str(raw.growiUserName, GROWI_USER_NAME_MAX);
    if (growiUserName === undefined) {
      return { error: 'malformed' };
    }
    return { status, growiUserName };
  }

  // status === 'link-issued'
  const linkUrl = str(raw.linkUrl, LINK_URL_MAX);
  const expiresAt = str(raw.expiresAt, EXPIRES_AT_MAX);
  if (linkUrl === undefined || expiresAt === undefined) {
    return { error: 'malformed' };
  }

  return { status, linkUrl, expiresAt };
};

/**
 * Confirms the wire shape of `SettingsPullResponse` (Requirement 11.4's
 * fallback path). A malformed value here REPLACES the admin's saved
 * permission configuration wholesale (design.md's rationale for this
 * whole file) -- `settings`/`version` reuse the exact same rules
 * `parse-settings.ts`'s `parseSettingsPush` already applies to the same
 * shapes, rather than re-deriving them here.
 */
export const parseSettingsPullResponse = (
  raw: unknown,
): SettingsPullResponse | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const settings = parseRelationSettings(raw.settings);
  const version = parseVersion(raw.version);

  if (settings === undefined || version === undefined) {
    return { error: 'malformed' };
  }

  return { settings, version };
};

const PAIRING_RESULT_STATUS_VALUES = [
  'paired',
  'code-expired',
  'ownership-unverified',
  'already-paired',
] as const;

const RELATION_ID_MAX = 128;
const WORKSPACE_ID_MAX = 200;
const WORKSPACE_NAME_MAX = 200;
/** A short human-readable explanation of why pairing did not complete. */
const DETAIL_MAX = 1000;

/**
 * Confirms the wire shape of `PairingResult` (Requirement 9's pairing
 * procedure). The `paired` variant's `publicKey` becomes the peer's
 * TRUSTED public key the moment it is persisted -- a malformed value here
 * is exactly the case design.md's rationale for this whole file warns
 * about. `publicKey` is checked via the shared `parsePublicKeyRegistration`
 * (this is the third of its three call sites -- see
 * common-fields.ts's doc comment and tasks.md's 6.3->6.5 Implementation
 * Note), never re-derived.
 */
export const parsePairingResult = (
  raw: unknown,
): PairingResult | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const status = oneOf(raw.status, PAIRING_RESULT_STATUS_VALUES);
  if (status === undefined) {
    return { error: 'malformed' };
  }

  if (status === 'code-expired') {
    return { status };
  }

  if (status === 'ownership-unverified' || status === 'already-paired') {
    const detail = str(raw.detail, DETAIL_MAX);
    if (detail === undefined) {
      return { error: 'malformed' };
    }
    return { status, detail };
  }

  // status === 'paired'
  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const workspaceRaw = raw.workspace;
  const publicKey = parsePublicKeyRegistration(raw.publicKey);

  if (
    relationId === undefined ||
    !isRecord(workspaceRaw) ||
    publicKey === undefined
  ) {
    return { error: 'malformed' };
  }

  const platform = oneOf(workspaceRaw.platform, PLATFORM_NAMES);
  const workspaceId = str(workspaceRaw.workspaceId, WORKSPACE_ID_MAX);
  const workspaceName = str(workspaceRaw.workspaceName, WORKSPACE_NAME_MAX);

  if (
    platform === undefined ||
    workspaceId === undefined ||
    workspaceName === undefined
  ) {
    return { error: 'malformed' };
  }

  return {
    status,
    relationId,
    workspace: { platform, workspaceId, workspaceName },
    publicKey,
  };
};

const CAPABILITY_LEVEL_VALUES = [
  'full',
  'degraded',
  'none',
  'unverified',
] as const;

const CAPABILITY_NAME_MAX = 100;
const SUBSTITUTE_MAX = 100;
/** Bounded well above `PLATFORM_NAMES`'s current size (4), for future growth. */
const PLATFORMS_MAX = 20;
const CAPABILITIES_MAX = 50;

type CapabilityRow =
  CapabilityReport['platforms'][number]['capabilities'][number];
type PlatformCapabilities = CapabilityReport['platforms'][number];

/**
 * `substitute` is `string | null` -- NOT optional. A missing key or an
 * explicit `undefined` must be rejected, since the contract type always
 * requires one of exactly these two shapes (never "absent").
 */
const parseSubstitute = (v: unknown): string | null | undefined => {
  if (v === null) {
    return null;
  }
  return str(v, SUBSTITUTE_MAX);
};

const parseCapabilityRow = (v: unknown): CapabilityRow | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const capability = str(v.capability, CAPABILITY_NAME_MAX);
  const level = oneOf(v.level, CAPABILITY_LEVEL_VALUES);
  const substitute = parseSubstitute(v.substitute);

  if (
    capability === undefined ||
    level === undefined ||
    substitute === undefined
  ) {
    return undefined;
  }

  return { capability, level, substitute };
};

const parsePlatformCapabilities = (
  v: unknown,
): PlatformCapabilities | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const platform = oneOf(v.platform, PLATFORM_NAMES);
  const capabilities = arr(
    v.capabilities,
    CAPABILITIES_MAX,
    parseCapabilityRow,
  );

  if (platform === undefined || capabilities === undefined) {
    return undefined;
  }

  return { platform, capabilities };
};

/**
 * Confirms the wire shape of `CapabilityReport` (Requirement 1.3's "what
 * works on this service" admin view).
 */
export const parseCapabilityReport = (
  raw: unknown,
): CapabilityReport | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const platforms = arr(
    raw.platforms,
    PLATFORMS_MAX,
    parsePlatformCapabilities,
  );
  if (platforms === undefined) {
    return { error: 'malformed' };
  }

  return { platforms };
};

const CHANNELS_MAX = 1000;

/**
 * Confirms the wire shape of `ChannelInventory` (Requirement 2.2/11.1).
 * This is the ONLY data notification-targeting decisions are made from --
 * design.md's rationale for this whole file names this type explicitly.
 * `ChannelInventory`'s channel-list-item shape is structurally identical
 * to `contract/common.ts`'s `ChannelRef` (same 4 fields, same types), so
 * this reuses `parseChannelRef` (common-fields.ts) directly rather than
 * re-deriving the same 4-field check a third time (`CommandRequest` and
 * `AccountLinkStartRequest` already share it via task 6.2).
 */
export const parseChannelInventory = (
  raw: unknown,
): ChannelInventory | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const channels = arr(raw.channels, CHANNELS_MAX, parseChannelRef);
  if (channels === undefined) {
    return { error: 'malformed' };
  }

  return { channels };
};

const CONNECTION_HEALTH_VALUES: ReadonlyArray<ConnectionHealth> = [
  'connected',
  'reconnecting',
  'failed',
  'not-applicable',
];

/** ISO-8601 timestamp (`Date#toISOString()`, see tasks.md's 4.3 Implementation Note). */
const SINCE_MAX = 64;

/**
 * Confirms the wire shape of `ConnectionStatusView` (Requirement 1.4).
 */
export const parseConnectionStatusView = (
  raw: unknown,
): ConnectionStatusView | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const platform = oneOf(raw.platform, PLATFORM_NAMES);
  const health = oneOf(raw.health, CONNECTION_HEALTH_VALUES);
  const since = str(raw.since, SINCE_MAX);

  if (platform === undefined || health === undefined || since === undefined) {
    return { error: 'malformed' };
  }

  return { platform, health, since };
};
