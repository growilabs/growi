import type { FC } from 'react';

import type { IActivity, IActivityHasId } from '~/interfaces/activity';
import { isAttachmentRemoveActivity } from '~/interfaces/activity';

import { AttachmentRemoveSnapshotDetail } from './AttachmentRemoveSnapshotDetail';

/**
 * A per-action formatted renderer. The dispatcher (ActivitySnapshotDetail) picks
 * one by scanning this array with `.find(r => r.canRender(activity))`, so the
 * discriminant is always the activity's `action` (via the type guard passed to
 * `defineRenderer`) and never the snapshot's contents.
 */
export type SnapshotDetailRenderer = {
  canRender: (activity: IActivityHasId) => boolean;
  Component: FC<{ activity: IActivityHasId }>;
};

/**
 * Binds an action type guard to the component that formats that action's
 * snapshot, so that:
 *   (a) pairing a guard with a component whose props require a snapshot shape the
 *       guard does not narrow to is a COMPILE ERROR at the registration site; and
 *   (b) the registered component receives the already-narrowed activity type and
 *       does not re-narrow (the discriminating `is*Activity` check lives only in
 *       the guard).
 *
 * `T` is the type the guard narrows to. It is constrained to
 * `Pick<IActivity, 'action' | 'snapshot'>` rather than `IActivityHasId` because
 * the upstream guards (e.g. `isAttachmentRemoveActivity`) narrow exactly that
 * `Pick` shape; the component still receives a full activity via `IActivityHasId & T`,
 * which re-attaches the id/identity fields to the guard's snapshot narrowing. This
 * is the "adjust the constraint toward `Pick`" resolution called out in the design.
 *
 * The single widening cast (`Component as FC<{ activity: IActivityHasId }>`) is the
 * ONLY assertion in this module and is sound at runtime: the dispatcher renders a
 * Component only after its `canRender` guard has passed, so the activity it is given
 * always satisfies `T`. `any` is never used.
 */
export const defineRenderer = <
  T extends Pick<IActivity, 'action' | 'snapshot'>,
>(
  canRender: (
    activity: Pick<IActivity, 'action' | 'snapshot'>,
  ) => activity is T,
  Component: FC<{ activity: IActivityHasId & T }>,
): SnapshotDetailRenderer => ({
  canRender,
  Component: Component as FC<{ activity: IActivityHasId }>,
});

/**
 * Single source of truth for "which action gets which formatted renderer".
 *
 * Invariants:
 * - Every entry discriminates purely on `action` (via its guard); entries are
 *   mutually exclusive (1 action = 1 entry).
 * - The dispatcher picks the FIRST match, so array order is precedence order.
 *
 * Adding a formatted renderer for another action is a one-line append here (e.g.
 * `defineRenderer(isAttachmentAddActivity, AttachmentAddSnapshotDetail)` once the
 * upstream ADD capture and guard exist); the dispatcher and table are untouched.
 */
export const snapshotDetailRenderers: SnapshotDetailRenderer[] = [
  defineRenderer(isAttachmentRemoveActivity, AttachmentRemoveSnapshotDetail),
];
