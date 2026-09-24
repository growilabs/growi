// Task 9.2: an administrator saves one relation's channel permissions, and
// the proxy is told about it (Requirements 11.1, 11.2, 11.4).
//
// The two halves are deliberately ordered and deliberately unequal in
// weight:
//
//   1. The save itself is the durable part, and it is transactional --
//      `writeRelationSettings` owns that (see its comment).
//   2. The push is best-effort, and runs only AFTER the commit. If it fails
//      -- refused, unreachable, or throwing -- the save STAYS. The proxy
//      fetches the settings through `settings-pull` (task 3.5) when its own
//      copy looks stale, so a failed push costs a delay, not the change
//      ("押し込みが失敗しても、proxy が 3.5 の口へ取りに来るので取りこぼしは
//      埋まる"). Failing the save on a push failure would be strictly worse:
//      the admin would be told nothing was saved while the new settings are
//      already committed and already in effect for `settings-pull`.
//
// The payload arrives from a browser, so its shape is checked here rather
// than trusted. `@growi/chat`'s own `parseRelationSettings` is deliberately
// not part of that package's public surface (it is an internal of
// `parseSettingsPush`/`parseSettingsPullResponse`), so the check is written
// against the same vocabulary the protocol declares -- `COMMAND_NAMES` --
// which is what keeps a saved `commandName` matching the name the proxy
// matches on.

import {
  COMMAND_NAMES,
  type CommandName,
  type RelationSettings,
} from '@growi/chat';

import loggerFactory from '~/utils/logger';

import { pushSettings } from '../proxy-client';
import {
  type WriteRelationSettingsResult,
  writeRelationSettings,
} from '../settings/relation-settings-store';

const logger = loggerFactory(
  'growi:features:chat-integration:admin:save-relation-settings',
);

/** Same bound the protocol's own `parseSettingsPush` applies to one command's list. */
const ALLOWED_CHANNELS_MAX = 1000;
const CHANNEL_ID_MAX_LENGTH = 200;

export type SaveRelationSettingsOutcome =
  | {
      readonly status: 'saved';
      readonly version: number;
      readonly push:
        | { readonly ok: true }
        | { readonly ok: false; readonly reason: string };
    }
  | { readonly status: 'relation-not-found' }
  | { readonly status: 'invalid-settings'; readonly detail: string }
  /**
   * The write was refused for a reason that goes away on its own -- two
   * administrators saving the same relation at the same moment. Nothing was
   * committed; saving again is the whole remedy.
   */
  | { readonly status: 'save-conflict' };

const COMMAND_NAME_VALUES: ReadonlyArray<string> = Object.values(COMMAND_NAMES);

/**
 * Whether a failed write is the kind that succeeds if simply retried.
 *
 * MongoDB reports a transaction that lost a race for the same document as
 * `WriteConflict` -- error code 112, also carrying the
 * `TransientTransactionError` label, which is the label the driver's own
 * retry helpers key off. Both are checked because the code identifies this
 * one situation precisely while the label covers the same class of
 * "nothing was written, try again" failures (a stepped-down primary, for
 * instance).
 */
const WRITE_CONFLICT_ERROR_CODE = 112;
const TRANSIENT_TRANSACTION_ERROR_LABEL = 'TransientTransactionError';

const isTransientWriteConflict = (error: unknown): boolean => {
  if (typeof error !== 'object' || error == null) {
    return false;
  }
  const { code, errorLabels } = error as {
    readonly code?: unknown;
    readonly errorLabels?: unknown;
  };
  return (
    code === WRITE_CONFLICT_ERROR_CODE ||
    (Array.isArray(errorLabels) &&
      errorLabels.includes(TRANSIENT_TRANSACTION_ERROR_LABEL))
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const parseAllowedChannels = (
  value: unknown,
): RelationSettings['channelPermissions'][number]['allowedChannels'] | null => {
  if (value === 'all' || value === 'none') {
    return value;
  }
  if (!Array.isArray(value) || value.length > ALLOWED_CHANNELS_MAX) {
    return null;
  }
  const isChannelId = (item: unknown): item is string =>
    typeof item === 'string' &&
    item.length > 0 &&
    item.length <= CHANNEL_ID_MAX_LENGTH;
  return value.every(isChannelId) ? [...value] : null;
};

type ParsedChannelPermissions =
  | {
      readonly ok: true;
      readonly channelPermissions: RelationSettings['channelPermissions'];
    }
  | { readonly ok: false; readonly detail: string };

const parseChannelPermissions = (raw: unknown): ParsedChannelPermissions => {
  if (!Array.isArray(raw)) {
    return { ok: false, detail: "'channelPermissions' must be an array" };
  }

  const parsed: Array<RelationSettings['channelPermissions'][number]> = [];
  const seen = new Set<CommandName>();

  for (const row of raw) {
    if (!isRecord(row)) {
      return {
        ok: false,
        detail: 'every channelPermissions entry must be an object',
      };
    }
    const { commandName } = row;
    if (
      typeof commandName !== 'string' ||
      !COMMAND_NAME_VALUES.includes(commandName)
    ) {
      return {
        ok: false,
        detail: `unknown commandName: ${String(commandName)}`,
      };
    }
    // The (relationId, commandName) unique index would refuse the second
    // row anyway; refused here instead so the administrator is told what is
    // wrong with the payload rather than shown a failed write.
    if (seen.has(commandName as CommandName)) {
      return {
        ok: false,
        detail: `duplicate commandName: ${commandName}`,
      };
    }
    const allowedChannels = parseAllowedChannels(row.allowedChannels);
    if (allowedChannels == null) {
      return {
        ok: false,
        detail: `invalid allowedChannels for '${commandName}': must be 'all', 'none', or a list of channel ids`,
      };
    }

    seen.add(commandName as CommandName);
    parsed.push({ commandName: commandName as CommandName, allowedChannels });
  }

  return { ok: true, channelPermissions: parsed };
};

export const saveRelationSettings = async (
  relationId: string,
  rawChannelPermissions: unknown,
): Promise<SaveRelationSettingsOutcome> => {
  const parsed = parseChannelPermissions(rawChannelPermissions);
  if (!parsed.ok) {
    return { status: 'invalid-settings', detail: parsed.detail };
  }
  const { channelPermissions } = parsed;

  let written: WriteRelationSettingsResult;
  try {
    written = await writeRelationSettings(relationId, channelPermissions);
  } catch (err) {
    // Two saves for the same relation in flight at once really do collide:
    // both transactions bump the same `chat_relations` document, and
    // MongoDB refuses one of them instead of serializing the pair. Nothing
    // of the refused one was committed, so this is reported as its own
    // outcome the administrator can act on ("save again"), rather than
    // being left to escape as a rejected promise.
    if (isTransientWriteConflict(err)) {
      logger.warn(
        `A concurrent save refused the settings write for relation '${relationId}'; nothing was committed.`,
        err,
      );
      return { status: 'save-conflict' };
    }
    throw err;
  }
  if (written.status === 'relation-not-found') {
    return { status: 'relation-not-found' };
  }

  const settings: RelationSettings = { relationId, channelPermissions };

  try {
    const pushed = await pushSettings(relationId, {
      settings,
      version: written.version,
    });
    if (!pushed.ok) {
      logger.warn(
        `Settings for relation '${relationId}' were saved at version ${written.version} but could not be pushed to the proxy (${pushed.reason}). The proxy will fetch them through settings-pull.`,
      );
      return {
        status: 'saved',
        version: written.version,
        push: { ok: false, reason: pushed.reason },
      };
    }
    return { status: 'saved', version: written.version, push: { ok: true } };
  } catch (err) {
    // `pushSettings` reports its own failures as `{ ok: false }`, so
    // reaching here means something unexpected threw. It still must not
    // undo or hide the save -- same reasoning as a refused push.
    logger.warn(
      `Pushing settings for relation '${relationId}' threw after the save committed at version ${written.version}:`,
      err,
    );
    return {
      status: 'saved',
      version: written.version,
      push: { ok: false, reason: 'push-threw' },
    };
  }
};
