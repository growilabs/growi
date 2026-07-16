import type { FC } from 'react';

import type { IActivityHasId } from '~/interfaces/activity';
import {
  isAttachmentRemoveActivity,
  SupportedAction,
} from '~/interfaces/activity';

import { AttachmentRemoveSnapshotDetail } from './AttachmentRemoveSnapshotDetail';
import { LiveAttachmentSnapshotDetail } from './LiveAttachmentSnapshotDetail';
import {
  defineRenderer,
  snapshotDetailRenderers,
} from './snapshot-detail-renderers';

// This spec is partly a TYPE-LEVEL gate: the `@ts-expect-error` below fails
// `tsgo --noEmit` (as "Unused '@ts-expect-error' directive") if the mismatched
// pairing ever stops being a compile error, so it durably proves property (a) of
// defineRenderer. The runtime `it`s document the registry's observable contract.

const buildActivity = (action: IActivityHasId['action']): IActivityHasId => ({
  _id: `activity-id-${action}`,
  action,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  snapshot: { originalName: 'photo.png' },
});

// The registered Component is widened to FC<{ activity: IActivityHasId }> by
// defineRenderer, so returning `unknown` here lets the identity assertions
// compare against the concrete component without fighting the widening.
const componentFor = (activity: IActivityHasId): unknown =>
  snapshotDetailRenderers.find((r) => r.canRender(activity))?.Component;

describe('snapshot-detail-renderers', () => {
  it('registers one entry per attachment action (REMOVE, ADD, DOWNLOAD)', () => {
    expect(snapshotDetailRenderers).toHaveLength(3);
  });

  it('routes each attachment action to its renderer purely by action', () => {
    // ADD and DOWNLOAD share the live-attachment renderer; REMOVE has its own.
    expect(
      componentFor(buildActivity(SupportedAction.ACTION_ATTACHMENT_ADD)),
    ).toBe(LiveAttachmentSnapshotDetail);
    expect(
      componentFor(buildActivity(SupportedAction.ACTION_ATTACHMENT_DOWNLOAD)),
    ).toBe(LiveAttachmentSnapshotDetail);
    expect(
      componentFor(buildActivity(SupportedAction.ACTION_ATTACHMENT_REMOVE)),
    ).toBe(AttachmentRemoveSnapshotDetail);
  });

  it('matches no entry for an unrelated action (raw fallback territory)', () => {
    const other = buildActivity(SupportedAction.ACTION_PAGE_CREATE);
    expect(snapshotDetailRenderers.some((r) => r.canRender(other))).toBe(false);
  });

  it('keeps the entries mutually exclusive (each action matches exactly one)', () => {
    for (const action of [
      SupportedAction.ACTION_ATTACHMENT_ADD,
      SupportedAction.ACTION_ATTACHMENT_REMOVE,
      SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    ]) {
      const matches = snapshotDetailRenderers.filter((r) =>
        r.canRender(buildActivity(action)),
      );
      expect(matches).toHaveLength(1);
    }
  });

  it('accepts a guard paired with its matching component (compiles)', () => {
    // The well-matched pair must type-check; if it did not, `tsgo` would fail here.
    const renderer = defineRenderer(
      isAttachmentRemoveActivity,
      AttachmentRemoveSnapshotDetail,
    );

    expect(renderer.canRender).toBe(isAttachmentRemoveActivity);
  });

  it('rejects a guard/component pair whose snapshot field types conflict (compile-time)', () => {
    // A genuine shape mismatch must be a compile error at the registration site.
    // The distinguishable mismatch for these all-optional snapshots is a
    // CONFLICTING field type: this component wants `fileSize` as a string, while
    // the REMOVE guard narrows to AttachmentRemoveSnapshot's `fileSize?: number`.
    // (An *extra* required field like `{ somethingElse: string }` would NOT be a
    // mismatch, because every field of AttachmentRemoveSnapshot is optional, so any
    // object is assignable to it — hence the negative case must conflict on a shared
    // field. A swap among the ADD/REMOVE/DOWNLOAD guards is likewise not
    // type-distinguishable: they narrow to the same AttachmentSnapshot shape.)
    const MismatchedComponent: FC<{
      activity: IActivityHasId & { snapshot?: { fileSize: string } };
    }> = () => null;

    // @ts-expect-error - REMOVE guard narrows fileSize to number; a component
    // requiring fileSize: string is not an assignable pairing.
    defineRenderer(isAttachmentRemoveActivity, MismatchedComponent);

    expect(snapshotDetailRenderers).toHaveLength(3);
  });
});
