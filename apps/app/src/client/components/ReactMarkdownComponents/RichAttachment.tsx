import React, { useCallback } from 'react';

import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import Image from 'next/image';
import prettyBytes from 'pretty-bytes';

import { useIsGuestUser, useIsReadOnlyUser, useIsSharedUser } from '~/states/context';
import { useDeleteAttachmentModalActions } from '~/states/ui/modal/delete-attachment';
import { useSWRxAttachment } from '~/stores/attachment';

import styles from './RichAttachment.module.scss';

type RichAttachmentProps = {
  attachmentId: string,
  url: string,
  attachmentName: string,
}

export const RichAttachment = React.memo((props: RichAttachmentProps) => {
  const { attachmentId, attachmentName } = props;
  const { t } = useTranslation();
  const { data: attachment, remove } = useSWRxAttachment(attachmentId);
  const { open: openDeleteAttachmentModal } = useDeleteAttachmentModalActions();

  const isGuestUser = useIsGuestUser();
  const isSharedUser = useIsSharedUser();
  const isReadOnlyUser = useIsReadOnlyUser();

  const showTrashButton = isGuestUser === false && isSharedUser === false && isReadOnlyUser === false;

  const onClickTrashButtonHandler = useCallback(() => {
    if (attachment == null) {
      return;
    }
    openDeleteAttachmentModal(attachment, remove);
  }, [attachment, openDeleteAttachmentModal, remove]);

  if (attachment == null) {
    return <span className="text-muted">{t('rich_attachment.attachment_not_be_found')}</span>;
  }

  const {
    filePathProxied,
    originalName,
    downloadPathProxied,
    creator,
    createdAt,
    fileSize,
  } = attachment;

  // Guard here because attachment properties might be deleted in turn when an attachment is removed
  if (filePathProxied == null
    || originalName == null
    || downloadPathProxied == null
    || creator == null
    || createdAt == null
    || fileSize == null
  ) {
    return <span className="text-muted">{t('rich_attachment.attachment_not_be_found')}</span>;
  }

  return (
    <div data-testid="rich-attachment" className={`${styles.attachment} d-inline-block`}>
      <div className="my-2 p-2 card">
        <div className="p-1 card-body d-flex align-items-center">
          <div className="me-2 px-0 d-flex align-items-center justify-content-center">
            <Image
              width={20}
              height={20}
              src="/images/icons/editor/attachment.svg"
              className="attachment-icon"
              alt="attachment icon"
            />
          </div>
          <div className="ps-0">
            <div className="d-inline-block">
              {/* Since we need to include the "referer" to view the attachment on the shared page */}
              {/* eslint-disable-next-line react/jsx-no-target-blank */}
              <a target="_blank" rel="noopener" href={filePathProxied}>
                {attachmentName || originalName}
              </a>
              <a className="ms-2 attachment-download" href={downloadPathProxied}>
                <span className="material-symbols-outlined">cloud_download</span>
              </a>

              {showTrashButton && (
                <a className="ml-2 text-danger attachment-delete d-share-link-none" type="button" onClick={onClickTrashButtonHandler}>
                  <span className="material-symbols-outlined">delete</span>
                </a>
              )}

            </div>
            <div className="d-flex align-items-center">
              <UserPicture user={creator} size="sm" />
              <span className="ms-2 text-muted">
                {new Date(createdAt).toLocaleString('en-US')}
              </span>
              <span className="ms-2 ps-2 border-start text-muted">{prettyBytes(fileSize)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
RichAttachment.displayName = 'RichAttachment';
