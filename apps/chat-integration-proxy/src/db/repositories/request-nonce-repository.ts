// Single-use values already seen on an incoming signed request (design.md's
// `request_nonce` table), read by `SignatureGuard` (`routes/signature-guard.ts`,
// a later task) to detect a replayed request.
//
// **`consumeNonce`'s signature is copied verbatim from design.md**
// (`(ref: KeyRef, nonce: string, expiresAt: Date) => Promise<boolean>`). The
// expiry `SignatureGuard` passes in is already clamped to the 300-second
// ceiling design.md requires (「`consumeNonce` に渡す期限は、送られてきた値では
// なく受ける側が上限（300秒）で切った値にする」) -- clamping is the caller's
// job; this repository stores whatever `expiresAt` it is given.
//
// **Atomicity is the entire point of this function.** A naive
// check-then-insert (read whether the triple exists, then insert if not) has
// a race: two concurrent requests carrying the same nonce can both read "not
// present" before either writes, and both would be treated as first-seen --
// which defeats replay protection precisely in the case it exists for (an
// attacker replaying a captured request concurrently with the original).
// `consumeNonce` instead attempts the insert directly and lets the table's
// primary key -- `(relation_id, key_id, nonce)` -- do the exclusion: the
// database allows exactly one of two concurrent inserts to succeed, so
// catching the resulting unique-constraint violation and answering `false`
// is what makes this atomic rather than racy.
import type { KeyRef } from '@growi/chat/server';

import { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../prisma-client.js';

export interface RequestNonceRepository {
  /**
   * `true` the first time `(ref.relationId, ref.keyId, nonce)` is seen
   * (the row was inserted); `false` when it was already present (a replay).
   */
  consumeNonce(ref: KeyRef, nonce: string, expiresAt: Date): Promise<boolean>;
  /**
   * Deletes every row past its `expiresAt`. Only the primitive (design.md:
   * 「期限切れを消す処理は関数として用意するだけにする」) -- the periodic,
   * lock-held run belongs to a later task (`runtime/sweeper.ts`).
   */
  deleteExpired(now: Date): Promise<number>;
}

/** Prisma's code for "unique constraint violated" -- the only outcome `consumeNonce` treats as a replay rather than rethrowing. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export const createRequestNonceRepository = (
  db: DbClient,
): RequestNonceRepository => ({
  consumeNonce: async (ref, nonce, expiresAt) => {
    try {
      await db.requestNonce.create({
        data: {
          relationId: ref.relationId,
          keyId: ref.keyId,
          nonce,
          expiresAt,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  },

  deleteExpired: async (now) => {
    const result = await db.requestNonce.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  },
});
