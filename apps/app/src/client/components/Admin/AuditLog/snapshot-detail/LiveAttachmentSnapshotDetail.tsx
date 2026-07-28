import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import type { AttachmentSnapshot, IActivityHasId } from '~/interfaces/activity';

import { AttachmentSnapshotFields } from './AttachmentSnapshotFields';

type LiveAttachmentSnapshotDetailProps = {
  activity: IActivityHasId & { snapshot?: AttachmentSnapshot };
};

/**
 * Formatted viewer for an attachment activity whose file still exists
 * (ACTION_ATTACHMENT_ADD / ACTION_ATTACHMENT_DOWNLOAD). Shares the file name /
 * size / page fields with the REMOVE renderer via AttachmentSnapshotFields, and
 * additionally links to the live file.
 *
 * Registered for both ADD and DOWNLOAD (see snapshot-detail-renderers), so
 * `activity` arrives already narrowed and is not re-narrowed here. The download
 * link is built from the activity's `target` (the attachment id, exposed by the
 * audit-log API) to match the attachment's `downloadPathProxied`
 * (`/download/{id}`). When `target` is absent (e.g. a legacy record) the link is
 * simply omitted while the other fields still render.
 */
export const LiveAttachmentSnapshotDetail: FC<
  LiveAttachmentSnapshotDetailProps
> = (props) => {
  const { activity } = props;
  const { t } = useTranslation();

  const { target } = activity;

  return (
    <dl className="row mb-0">
      <AttachmentSnapshotFields snapshot={activity.snapshot} />
      {target != null && (
        <div className="col-12">
          <a href={`/download/${target}`}>
            {t('admin:audit_log_snapshot.download')}
          </a>
        </div>
      )}
    </dl>
  );
};
