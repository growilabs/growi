// What already happened for one notification request, recorded per
// destination (design.md's `processed_notification_target` table).
//
// **Why per destination, not per `(relationId, requestId)`.** design.md is
// explicit about the failure this avoids: 「同じ `requestId` の 2 回目は、
// `posted` になっていない宛先だけを投稿し直す。`(relation_id, request_id)` で
// 丸ごと弾くと…投稿を一度も試みず…直しようのない状態になる。」A caller retrying a
// notification must be able to see, per destination, whether it already
// succeeded, and write the result of retrying ONE destination without
// touching the others' rows -- which is why there is no bulk
// clear-and-rewrite function here, only `findAllForRequest` (read every
// destination's status) and `upsertTarget` (write exactly one).
import type { DbClient } from '../prisma-client.js';

export interface ProcessedNotificationTargetRecord {
  readonly relationId: string;
  readonly requestId: string;
  readonly platform: string;
  readonly channelId: string;
  readonly status: string;
  readonly detail: string | null;
  readonly processedAt: Date;
  readonly expiresAt: Date;
}

export interface ProcessedNotificationRepository {
  /**
   * Every destination recorded so far for `(relationId, requestId)`, so a
   * retry can see which are already `posted` and skip re-posting only those
   * -- design.md: 「応答は常に `targets` 全件ぶんを返し、前回 `posted` だった宛先は
   * その結果をそのまま載せる。」
   */
  findAllForRequest(
    relationId: string,
    requestId: string,
  ): Promise<ReadonlyArray<ProcessedNotificationTargetRecord>>;
  /** Writes (or overwrites) the result for exactly one destination, leaving every other destination's row untouched. */
  upsertTarget(target: ProcessedNotificationTargetRecord): Promise<void>;
  /**
   * Deletes every row past its `expiresAt`. Only the primitive (design.md:
   * 「期限切れを消す処理は関数として用意するだけにする」) -- the periodic,
   * lock-held run belongs to a later task (`runtime/sweeper.ts`).
   */
  deleteExpired(now: Date): Promise<number>;
  /**
   * Deletes every row of a relation. Part of the ordered removal sequences
   * design.md specifies -- unpairing one relation, and removing a whole
   * installation. Composing the sequence belongs to the caller
   * (`PairingService.unpair()`, `InstallationStore.remove()`); this is only
   * the primitive.
   */
  deleteByRelation(relationId: string): Promise<number>;
}

const toRecord = (
  row: ProcessedNotificationTargetRecord,
): ProcessedNotificationTargetRecord => ({
  relationId: row.relationId,
  requestId: row.requestId,
  platform: row.platform,
  channelId: row.channelId,
  status: row.status,
  detail: row.detail,
  processedAt: row.processedAt,
  expiresAt: row.expiresAt,
});

export const createProcessedNotificationRepository = (
  db: DbClient,
): ProcessedNotificationRepository => ({
  findAllForRequest: async (relationId, requestId) => {
    const rows = await db.processedNotificationTarget.findMany({
      where: { relationId, requestId },
    });
    return rows.map(toRecord);
  },

  upsertTarget: async (target) => {
    await db.processedNotificationTarget.upsert({
      where: {
        relationId_requestId_platform_channelId: {
          relationId: target.relationId,
          requestId: target.requestId,
          platform: target.platform,
          channelId: target.channelId,
        },
      },
      create: { ...target },
      update: {
        status: target.status,
        detail: target.detail,
        processedAt: target.processedAt,
        expiresAt: target.expiresAt,
      },
    });
  },

  deleteExpired: async (now) => {
    const result = await db.processedNotificationTarget.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  },

  deleteByRelation: async (relationId) => {
    const result = await db.processedNotificationTarget.deleteMany({
      where: { relationId },
    });
    return result.count;
  },
});
