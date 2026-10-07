import type { FC } from 'react';

import type {
  AttachmentRemoveSnapshot,
  IActivityHasId,
} from '~/interfaces/activity';

import { AttachmentSnapshotFields } from './AttachmentSnapshotFields';

type AttachmentRemoveSnapshotDetailProps = {
  activity: IActivityHasId & { snapshot?: AttachmentRemoveSnapshot };
};

/**
 * Formatted viewer for an ATTACHMENT_REMOVE activity's snapshot: file name,
 * human-readable size, and a link to the page the attachment belonged to
 * (delegated to AttachmentSnapshotFields). The renderer is registered only for
 * the REMOVE action (see snapshot-detail-renderers), so `activity` arrives
 * already narrowed to `snapshot?: AttachmentRemoveSnapshot` and is not
 * re-narrowed here.
 *
 * No download link is ever rendered: the underlying file no longer exists once
 * it has been removed. This is the sole behavioral difference from the
 * still-existing-attachment renderer (LiveAttachmentSnapshotDetail), which adds
 * a download link on top of the same shared fields.
 */
export const AttachmentRemoveSnapshotDetail: FC<
  AttachmentRemoveSnapshotDetailProps
> = (props) => {
  const { activity } = props;

  return (
    <dl className="row mb-0">
      <AttachmentSnapshotFields snapshot={activity.snapshot} />
    </dl>
  );
};
