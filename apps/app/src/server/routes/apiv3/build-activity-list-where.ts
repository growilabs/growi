/**
 * Pure function that converts parsed audit-log search filter fields into a
 * Prisma `activitiesWhereInput` object.
 *
 * Extracted from the route handler for unit-testability (coding-style: pure
 * function extraction).  Has no side effects and does not access the database.
 *
 * Requirements: 2.2 — filter conversion same as Mongoose
 * Design: "apiv3/activity.ts" node in File Structure Plan
 */

import { addMinutes } from 'date-fns/addMinutes';

import type { Prisma } from '~/generated/prisma/client';

export type ActivityListWhereInput = Prisma.activitiesWhereInput;

export type ActivityListFilterInput = {
  /** Pre-validated username array (undefined or empty → clause omitted) */
  usernames: string[] | undefined;
  /**
   * Pre-filtered action array. `undefined` = filter absent (clause omitted →
   * all results). `[]` = filter present but all actions invalid (clause emitted
   * as `action: { in: [] }` → zero results, matching the original Mongoose
   * `{ action: [] }` $in:[] behaviour, req 2.2).
   */
  actions: string[] | undefined;
  /** Valid start Date (undefined → clause omitted unless start-only branch) */
  startDate: Date | undefined;
  /** Valid end Date (undefined → start-only branch when startDate present) */
  endDate: Date | undefined;
};

/**
 * Build a Prisma `where` object for the activities list query.
 *
 * Each clause is only included when the corresponding filter has a meaningful
 * value, mirroring the existing Mongoose conditional `Object.assign` logic.
 *
 * Date logic (req 2.2, preserved exactly from Mongoose route):
 * - Both startDate + endDate valid → gte:start, lt:addMinutes(end, 1439)
 * - startDate only valid          → gte:start, lt:addMinutes(start, 1439)
 * - Neither valid                 → no createdAt clause
 *
 * Username filter uses Prisma composite-type filter syntax (design R1 option a):
 *   snapshot: { is: { username: { in: [...] } } }
 */
export function buildActivityListWhere(
  input: ActivityListFilterInput,
): ActivityListWhereInput {
  const { usernames, actions, startDate, endDate } = input;
  const where: ActivityListWhereInput = {};

  // username → snapshot composite type filter
  const canContainUsernameFilter =
    usernames != null &&
    usernames.length > 0 &&
    usernames.every((u) => typeof u === 'string');
  if (canContainUsernameFilter) {
    where.snapshot = {
      is: { username: { in: usernames } },
    };
  }

  // action filter
  //
  // Mirror the original Mongoose handler: the clause is added whenever the
  // actions input is non-null, EVEN when it is empty (all submitted actions
  // were filtered out by getAvailableActions). Mongoose treated `{ action: [] }`
  // as `{ action: { $in: [] } }` → zero results; Prisma `{ action: { in: [] } }`
  // does the same. Omitting the clause on empty would instead return ALL rows,
  // which is an observable divergence (req 2.2). The caller conveys the
  // null-vs-empty distinction: `undefined` = filter absent (omit → all results),
  // `[]` = present-but-all-invalid (emit in:[] → zero results).
  if (actions != null) {
    where.action = { in: actions };
  }

  // date range filter — preserve the exact existing logic including start-only branch
  if (startDate != null && endDate != null) {
    where.createdAt = {
      gte: startDate,
      // + 23 hours 59 minutes (same as Mongoose route)
      lt: addMinutes(endDate, 1439),
    };
  } else if (startDate != null) {
    where.createdAt = {
      gte: startDate,
      // + 23 hours 59 minutes
      lt: addMinutes(startDate, 1439),
    };
  }

  return where;
}
