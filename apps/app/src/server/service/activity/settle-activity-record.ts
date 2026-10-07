import type { IActivity } from '~/interfaces/activity';
import type {
  IActivityParameters,
  IActivityUpdateParameters,
} from '~/server/models/activity';
import { prisma } from '~/utils/prisma';

import type { PendingActivityContext } from './pending-activity-context';

export type SettleActivityRecordInput = {
  activityId: string;
  /** = ActivityService.shoudUpdateActivity(action). Injected, never computed here. */
  shouldPersist: boolean;
  /** Request-time context taken from pendingActivityContext by the caller. */
  context: PendingActivityContext | undefined;
  /** Settle params from emit (action/target/snapshot...); `contributor` is stripped by the caller. */
  activityParameters: IActivityUpdateParameters;
};

/**
 * Settle the record lifecycle by CREATING the row lazily (Option C / lazy fail-safe):
 *  - shouldPersist=true  -> createByParameters({ id, ...context, ...params }) -> activity
 *  - shouldPersist=false -> null (create nothing; no write for an out-of-gate action)
 *
 * Pure record-lifecycle policy only: does NOT decide record-eligibility itself
 * (that is the single source of truth `getAvailableActions`/`shoudUpdateActivity`,
 * owned by the caller), and does NOT depend on contribution, notification,
 * snapshot content, route-specific payload, or `pendingActivityContext` (the
 * context arrives as an argument, already `take`n by the caller). Must not
 * import `ActivityService` (circular-dependency avoidance -- design.md:
 * Service / 記録ライフサイクル > settleActivityRecord, Dependencies).
 *
 * Requirements: 1.1, 1.2, 2.6, 3.1, 3.2
 */
export function settleActivityRecord(
  input: SettleActivityRecordInput,
): Promise<IActivity | null> {
  const { activityId, shouldPersist, context, activityParameters } = input;

  if (!shouldPersist) {
    // Out-of-gate: create nothing (no write for a recording-target action --
    // Requirement 1.1). No `await` needed; wrap in a resolved promise to
    // satisfy the declared Promise-returning contract.
    return Promise.resolve(null);
  }

  // Map the pending context onto the SHAPE `createByParameters` actually reads
  // (models/activity.ts), NOT a raw spread. `createByParameters` derives the
  // row's `userId` from `user` (via `normalizeToId(user)`) and never consumes
  // a top-level `userId`; and the operator NAME lives only inside the snapshot
  // composite as `snapshot.username` -- the `activities` model/schema has no
  // top-level `username` column, so a stray top-level `username` would make
  // Prisma `create` throw (Unknown argument). Hence:
  //   - operator id   -> `user`            (Req 1.2/2.6: userId must survive)
  //   - operator name -> `snapshot.username` (Req 2.6: 操作者名 must survive)
  //   - arrival time  -> `createdAt`        (Issue 3: not the settle time)
  const params: IActivityParameters = {
    id: activityId,
    ip: context?.ip,
    endpoint: context?.endpoint,
    createdAt: context?.createdAt,
    user: context?.userId,
    // `activityParameters` is typed from Prisma's UPDATE input
    // (IActivityUpdateParameters), whose fields permit field-update-operation
    // envelopes (`{ set: ... }`) and nullable variants that the flat create
    // input (IActivityParameters) does not, and whose `action` is optional.
    // At runtime `action` is always a definite string here: the listener only
    // reaches settle after reading `parameters.action` to compute
    // `shouldPersist`, and every real emit('update', ...) caller passes plain
    // scalar values only (action string, target id -- see e.g.
    // personal-setting/generate-access-token.ts, apiv3/page/index.ts), never an
    // envelope. So the runtime shape already matches the create input; this
    // narrow cast (scoped to the spread source only) bridges the static
    // update-vs-create type gap. The context fields above and the snapshot
    // below stay fully type-checked.
    ...(activityParameters as IActivityParameters),
    snapshot: {
      // Preserve any action-specific snapshot fields (originalName/pagePath/...)
      // the caller supplied, then settle the operator username. Precedence
      // mirrors the baseline updateByParameters merge (buildSnapshotUpdateEnvelope):
      // an explicitly-provided snapshot username wins, and when absent the
      // operator's context username (burned in by the middleware) is kept, so
      // it is never dropped (Req 2.6). No current emit('update') caller sets a
      // snapshot username, so in practice context.username is authoritative.
      ...activityParameters.snapshot,
      username: activityParameters.snapshot?.username ?? context?.username,
    },
  };

  return prisma.activities.createByParameters(params);
}
