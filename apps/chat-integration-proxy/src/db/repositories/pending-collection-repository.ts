// A command invocation waiting for more input -- a modal submission, a
// follow-up answer, or a choice of which GROWI to act on (design.md's
// `pending_collection` table, and the storage half of the `ArgumentCollector`
// interface design.md declares for `command/`).
//
// This file provides the storage primitives `ArgumentCollector` (a later
// task, `command/`) composes into `start()` / `resume()` / `sweepExpired()`.
// It does not enforce design.md's "one in-flight collection per (channel,
// user)" invariant -- `findInFlight` only exposes the lookup that
// enforcement needs, the same way `peer-key-repository.findPublicKey` exposes
// a lookup without deciding who may call it.
//
// `collected` and `offeredOptions` are opaque JSON here on purpose: their
// shape is `ArgumentCollector`'s concern (partial `FieldSpec` values, and the
// options a `GrowiSelector` choice offered), not something a storage
// primitive needs to interpret to persist and return it unchanged.

import type { Prisma } from '../../generated/prisma/client.js';
import type { Invocation } from '../../types/index.js';
import type { DbClient } from '../prisma-client.js';

export interface PendingCollectionRecord {
  readonly correlationId: string;
  /** `null` while the GROWI destination is still being chosen. */
  readonly relationId: string | null;
  readonly platform: string;
  readonly channelId: string;
  readonly actorAccountId: string;
  readonly commandName: string;
  readonly invocation: Invocation;
  readonly collected: unknown;
  readonly offeredOptions: unknown;
  readonly expiresAt: Date;
}

export type NewPendingCollection = Omit<
  PendingCollectionRecord,
  'relationId'
> & {
  readonly relationId?: string | null;
};

export interface PendingCollectionUpdate {
  readonly relationId?: string | null;
  readonly collected?: unknown;
  readonly offeredOptions?: unknown;
  readonly expiresAt?: Date;
}

export interface PendingCollectionRepository {
  create(collection: NewPendingCollection): Promise<PendingCollectionRecord>;
  findByCorrelationId(
    correlationId: string,
  ): Promise<PendingCollectionRecord | null>;
  /**
   * The collection already in flight for this `(platform, channelId,
   * actorAccountId)`, if any -- matches the table's index. Whether a new
   * command discards it (and tells the user it discarded something) is
   * `ArgumentCollector.start`'s decision, not this repository's.
   */
  findInFlight(
    platform: string,
    channelId: string,
    actorAccountId: string,
  ): Promise<PendingCollectionRecord | null>;
  update(correlationId: string, update: PendingCollectionUpdate): Promise<void>;
  /** Used once a collection completes or is explicitly discarded. */
  remove(correlationId: string): Promise<void>;
  /**
   * Deletes every row past its `expiresAt`. This is only the primitive
   * (design.md: 「期限切れを消す処理は関数として用意するだけにする」) -- taking
   * a distributed lock and running this on a schedule belongs to a later
   * task (`runtime/sweeper.ts`), not to this repository.
   */
  deleteExpired(now: Date): Promise<number>;
  /**
   * Deletes every row of a relation. Part of the ordered removal sequences
   * design.md specifies (unpairing one relation, removing a whole
   * installation).
   *
   * A collection whose GROWI destination has not been chosen yet has a NULL
   * `relation_id` (and no foreign key onto `installation` at all), so no such
   * row is reachable from a relation id and none is deleted here. That is
   * deliberate: those rows do not block either removal, and `deleteExpired`
   * reaps them at their `expires_at`.
   */
  deleteByRelation(relationId: string): Promise<number>;
}

interface PendingCollectionRow {
  readonly correlationId: string;
  readonly relationId: string | null;
  readonly platform: string;
  readonly channelId: string;
  readonly actorAccountId: string;
  readonly commandName: string;
  readonly invocation: unknown;
  readonly collected: unknown;
  readonly offeredOptions: unknown;
  readonly expiresAt: Date;
}

const toRecord = (row: PendingCollectionRow): PendingCollectionRecord => ({
  correlationId: row.correlationId,
  relationId: row.relationId,
  platform: row.platform,
  channelId: row.channelId,
  actorAccountId: row.actorAccountId,
  commandName: row.commandName,
  // The JSON column round-trips whatever was written; the caller that wrote
  // it is the one that knows it was an `Invocation`.
  invocation: row.invocation as Invocation,
  collected: row.collected,
  offeredOptions: row.offeredOptions,
  expiresAt: row.expiresAt,
});

export const createPendingCollectionRepository = (
  db: DbClient,
): PendingCollectionRepository => ({
  create: async (collection) => {
    const row = await db.pendingCollection.create({
      data: {
        ...collection,
        relationId: collection.relationId ?? null,
        invocation: collection.invocation as unknown as Prisma.InputJsonValue,
        collected: collection.collected as Prisma.InputJsonValue,
        offeredOptions: collection.offeredOptions as Prisma.InputJsonValue,
      },
    });
    return toRecord(row);
  },

  findByCorrelationId: async (correlationId) => {
    const row = await db.pendingCollection.findUnique({
      where: { correlationId },
    });
    return row == null ? null : toRecord(row);
  },

  findInFlight: async (platform, channelId, actorAccountId) => {
    const row = await db.pendingCollection.findFirst({
      where: { platform, channelId, actorAccountId },
    });
    return row == null ? null : toRecord(row);
  },

  update: async (correlationId, update) => {
    await db.pendingCollection.update({
      where: { correlationId },
      data: {
        ...(update.relationId !== undefined && {
          relationId: update.relationId,
        }),
        ...(update.collected !== undefined && {
          collected: update.collected as Prisma.InputJsonValue,
        }),
        ...(update.offeredOptions !== undefined && {
          offeredOptions: update.offeredOptions as Prisma.InputJsonValue,
        }),
        ...(update.expiresAt !== undefined && {
          expiresAt: update.expiresAt,
        }),
      },
    });
  },

  remove: async (correlationId) => {
    await db.pendingCollection.delete({ where: { correlationId } });
  },

  deleteExpired: async (now) => {
    const result = await db.pendingCollection.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  },

  deleteByRelation: async (relationId) => {
    const result = await db.pendingCollection.deleteMany({
      where: { relationId },
    });
    return result.count;
  },
});
