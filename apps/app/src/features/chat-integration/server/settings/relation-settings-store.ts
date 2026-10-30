// Reading and writing one relation's channel-permission settings
// (Requirement 11.1/11.4). Both directions live here so that what the admin
// screen saves and what `settings-pull` (task 3.5) hands the proxy can never
// be two different readings of the same rows.

import type { RelationSettings, SettingsPullResponse } from '@growi/chat';
import mongoose from 'mongoose';

import { ChatRelation } from '../models/chat-relation';
import {
  toStoredAllowedChannels,
  toWireAllowedChannels,
} from './allowed-channels';
import { ChatChannelPermission } from './models/chat-channel-permission';

/**
 * `relation-not-found` covers BOTH "no such relation" and "the relation is
 * no longer active": a caller cannot do anything different about them, and
 * `unpairRelation` deliberately deletes an unpaired relation's permission
 * rows, so re-creating them here is exactly what must not happen (see
 * `writeRelationSettings`).
 */
export type WriteRelationSettingsResult =
  | { readonly status: 'saved'; readonly version: number }
  | { readonly status: 'relation-not-found' };

/**
 * This relation's settings exactly as the proxy is told them, or `null` when
 * no such relation exists.
 */
export const readRelationSettings = async (
  relationId: string,
): Promise<SettingsPullResponse | null> => {
  const relation = await ChatRelation.findOne({ relationId }).lean();
  if (relation == null) {
    return null;
  }

  const rows = await ChatChannelPermission.find({ relationId }).lean();
  const channelPermissions: RelationSettings['channelPermissions'] = rows.map(
    (row) => ({
      commandName: row.commandName,
      allowedChannels: toWireAllowedChannels(row),
    }),
  );

  return {
    settings: { relationId, channelPermissions },
    version: relation.settingsVersion,
  };
};

/**
 * Replaces this relation's channel-permission rows and bumps its
 * `settingsVersion` by one, IN A SINGLE TRANSACTION.
 *
 * The transaction is the point of this function, not an optimization: the
 * rows and the version live in two different collections, and a half-written
 * save where only the version moved makes the proxy treat the OLD settings
 * as the newest ones -- it discards any push or pull whose version is not
 * larger than the version it already holds, so the correct settings would
 * never reach it again until the next save (design.md: "版だけ進むと proxy は
 * 古い設定を新しいものとして受け取る").
 *
 * The rows are replaced wholesale rather than merged, because the whole
 * settings object is what goes over the wire every time: a row left behind
 * from an earlier save would be pushed as though it were still configured.
 *
 * devcontainer's MongoDB is a replica set, so `session.startTransaction()`
 * is available in every environment this runs in (see
 * .claude/rules/devcontainer.md). Follows `approveAccountLink`'s shape.
 *
 * Callers pass settings that have already been checked
 * (`save-relation-settings.ts`); a write that MongoDB refuses anyway (e.g.
 * two rows for the same command hitting the `(relationId, commandName)`
 * unique index) is left to throw, after the transaction has aborted, rather
 * than being reported as an outcome -- by then nothing was committed, which
 * is the only guarantee this function makes about a failed write.
 */
export const writeRelationSettings = async (
  relationId: string,
  channelPermissions: RelationSettings['channelPermissions'],
): Promise<WriteRelationSettingsResult> => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Bumped with `$inc` rather than read-then-write so two concurrent
    // saves cannot both compute the same next version.
    //
    // Filtered on `state: 'active'`, not on `relationId` alone: this
    // endpoint accepts a raw POST for any relation id an administrator
    // cares to name, and `unpairRelation` DELETES an unpaired relation's
    // permission rows on purpose. Without this term a save would re-create
    // rows for a relation that is no longer paired and bump its version,
    // undoing that cleanup.
    const relation = await ChatRelation.findOneAndUpdate(
      { relationId, state: 'active' },
      { $inc: { settingsVersion: 1 } },
      { new: true, session },
    );

    if (relation == null) {
      await session.abortTransaction();
      return { status: 'relation-not-found' };
    }

    await ChatChannelPermission.deleteMany({ relationId }, { session });
    if (channelPermissions.length > 0) {
      await ChatChannelPermission.insertMany(
        channelPermissions.map((permission) => ({
          relationId,
          commandName: permission.commandName,
          ...toStoredAllowedChannels(permission.allowedChannels),
        })),
        { session },
      );
    }

    await session.commitTransaction();
    return { status: 'saved', version: relation.settingsVersion };
  } finally {
    await session.endSession();
  }
};
