import type { FC } from 'react';
import prettyBytes from 'pretty-bytes';
import { useTranslation } from 'react-i18next';

import { PagePathHierarchicalLink } from '~/components/Common/PagePathHierarchicalLink';
import type {
  AttachmentRemoveSnapshot,
  IActivityHasId,
} from '~/interfaces/activity';
import { LinkedPagePath } from '~/models/linked-page-path';

type AttachmentRemoveSnapshotDetailProps = {
  activity: IActivityHasId & { snapshot?: AttachmentRemoveSnapshot };
};

/**
 * Formatted viewer for an ATTACHMENT_REMOVE activity's snapshot: file name,
 * human-readable size, and a link to the page the attachment belonged to.
 * The renderer is registered only for the REMOVE action (see
 * snapshot-detail-renderers), so `activity` arrives already narrowed to
 * `snapshot?: AttachmentRemoveSnapshot` and is not re-narrowed here.
 *
 * Every field is judged independently so that one missing field never stops
 * the others from rendering. No download link is ever rendered here: the
 * underlying file no longer exists once it has been removed.
 */
export const AttachmentRemoveSnapshotDetail: FC<
  AttachmentRemoveSnapshotDetailProps
> = (props) => {
  const { activity } = props;
  const { t } = useTranslation();

  const { originalName, fileSize, pagePath } = activity.snapshot ?? {};

  const fileNameContent =
    originalName ?? t('admin:audit_log_snapshot.unknown_file_name');
  // `fileSize` may legitimately be 0 (an empty file), so check presence with
  // `== null` rather than falsiness.
  const fileSizeContent =
    fileSize == null
      ? t('admin:audit_log_snapshot.unknown_size')
      : prettyBytes(fileSize);
  const pageContent =
    pagePath != null ? (
      <PagePathHierarchicalLink linkedPagePath={new LinkedPagePath(pagePath)} />
    ) : (
      t('admin:audit_log_snapshot.page_unavailable')
    );

  return (
    <dl className="row mb-0">
      <div className="col-12 d-flex">
        <dt className="me-2">{t('admin:audit_log_snapshot.file_name')}</dt>
        <dd>{fileNameContent}</dd>
      </div>
      <div className="col-12 d-flex">
        <dt className="me-2">{t('admin:audit_log_snapshot.file_size')}</dt>
        <dd>{fileSizeContent}</dd>
      </div>
      <div className="col-12 d-flex">
        <dt className="me-2">{t('admin:audit_log_snapshot.page')}</dt>
        <dd>{pageContent}</dd>
      </div>
    </dl>
  );
};
