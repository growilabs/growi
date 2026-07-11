import type { FC } from 'react';

import type { IActivityHasId } from '~/interfaces/activity';
import {
  isAttachmentRemoveActivity,
  SupportedAction,
} from '~/interfaces/activity';

import { AttachmentRemoveSnapshotDetail } from './AttachmentRemoveSnapshotDetail';
import {
  defineRenderer,
  snapshotDetailRenderers,
} from './snapshot-detail-renderers';

// This spec is primarily a TYPE-LEVEL gate: the `@ts-expect-error` below fails
// `tsgo --noEmit` (as "Unused '@ts-expect-error' directive") if the mismatched
// pairing ever stops being a compile error, so it durably proves property (a) of
// defineRenderer. The runtime `it`s document the registry's observable contract.

describe('snapshot-detail-renderers', () => {
  it('registers exactly one entry (the ATTACHMENT_REMOVE renderer)', () => {
    expect(snapshotDetailRenderers).toHaveLength(1);
  });

  it('discriminates the registered entry purely by action', () => {
    const [entry] = snapshotDetailRenderers;

    const removeActivity: IActivityHasId = {
      _id: 'activity-id-remove',
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      snapshot: { originalName: 'photo.png' },
    };
    const otherActivity: IActivityHasId = {
      _id: 'activity-id-other',
      action: SupportedAction.ACTION_PAGE_CREATE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      snapshot: { username: 'alice' },
    };

    expect(entry.canRender(removeActivity)).toBe(true);
    expect(entry.canRender(otherActivity)).toBe(false);
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

    expect(snapshotDetailRenderers).toHaveLength(1);
  });
});
