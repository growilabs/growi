// Confirms the wire shape of two signed bodies, per the File Structure
// Plan's `parse-settings.ts` comment ("parseSettingsPush /
// parseAccountLinkStart"): the settings-push round trip (Requirement
// 11.1/11.2/11.4) and account-link start (Requirement 7). See
// parse-command.ts's header comment for why every parse* function here
// re-checks shape even though the body already passed signature
// verification.

import { COMMAND_NAMES, type CommandName } from '../commands/command-names.js';
import type { AccountLinkStartRequest } from '../contract/account-link.js';
import type {
  RelationSettings,
  SettingsPushRequest,
} from '../contract/settings.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { parseChatAccountRef } from './common-fields.js';
import { arr, isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;
const CHANNEL_ID_MAX = 200;
/** Bounded well above `COMMAND_NAMES`'s current size (5), for future growth. */
const CHANNEL_PERMISSIONS_MAX = 50;
/** A single command's allow-list of channels. */
const ALLOWED_CHANNELS_MAX = 1000;

type ParseError = { readonly error: 'malformed' };

const COMMAND_NAME_VALUES: ReadonlyArray<CommandName> =
  Object.values(COMMAND_NAMES);

type ChannelPermissionRow = RelationSettings['channelPermissions'][number];

const parseAllowedChannels = (
  v: unknown,
): ChannelPermissionRow['allowedChannels'] | undefined => {
  if (v === 'all' || v === 'none') {
    return v;
  }
  return arr(v, ALLOWED_CHANNELS_MAX, (item) => str(item, CHANNEL_ID_MAX));
};

const parseChannelPermissionRow = (
  v: unknown,
): ChannelPermissionRow | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const commandName = oneOf(v.commandName, COMMAND_NAME_VALUES);
  const allowedChannels = parseAllowedChannels(v.allowedChannels);

  if (commandName === undefined || allowedChannels === undefined) {
    return undefined;
  }

  return { commandName, allowedChannels };
};

const parseVersion = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

const parseRelationSettings = (v: unknown): RelationSettings | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const relationId = str(v.relationId, RELATION_ID_MAX);
  const channelPermissions = arr(
    v.channelPermissions,
    CHANNEL_PERMISSIONS_MAX,
    parseChannelPermissionRow,
  );

  if (relationId === undefined || channelPermissions === undefined) {
    return undefined;
  }

  return { relationId, channelPermissions };
};

export const parseSettingsPush = (
  raw: unknown,
): SettingsPushRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, [OP_NAMES.settingsPush]);
  const settings = parseRelationSettings(raw.settings);
  const version = parseVersion(raw.version);

  if (
    relationId === undefined ||
    op === undefined ||
    settings === undefined ||
    version === undefined
  ) {
    return { error: 'malformed' };
  }

  return { relationId, op, settings, version };
};

export const parseAccountLinkStart = (
  raw: unknown,
): AccountLinkStartRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, [OP_NAMES.accountLinkStart]);
  const actor = parseChatAccountRef(raw.actor);

  if (relationId === undefined || op === undefined || actor === undefined) {
    return { error: 'malformed' };
  }

  return { relationId, op, actor };
};
