import type { FC } from 'react';
import prettyBytes from 'pretty-bytes';
import { useTranslation } from 'react-i18next';

import { PagePathHierarchicalLink } from '~/components/Common/PagePathHierarchicalLink';
import type { AttachmentSnapshot } from '~/interfaces/activity';
import { LinkedPagePath } from '~/models/linked-page-path';

type AttachmentSnapshotFieldsProps = {
  snapshot?: AttachmentSnapshot;
};

/**
 * Presentational fields shared by every attachment snapshot renderer: file
 * name, human-readable size, and a link to the page the attachment belonged
 * to. Returns the `<dt>`/`<dd>` rows only (no `<dl>` wrapper) so the caller
 * owns the list and can append its own rows (e.g. a download link for
 * still-existing attachments).
 *
 * Every field is judged independently so that one missing field never stops
 * the others from rendering. This component holds no download link: whether a
 * link is appropriate depends on the action (removed vs. still existing) and
 * is decided by the caller.
 */
export const AttachmentSnapshotFields: FC<AttachmentSnapshotFieldsProps> = (
  props,
) => {
  const { snapshot } = props;
  const { t } = useTranslation();

  const { originalName, fileSize, pagePath } = snapshot ?? {};

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
    <>
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
    </>
  );
};
