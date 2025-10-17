import React, {
  useCallback, useMemo, useState,
} from 'react';

import type { IAttachmentHasId } from '@growi/core';
import { UserPicture, LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import {
  Button, Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { toastSuccess, toastError } from '~/client/util/toastr';
import { useDeleteAttachmentModalStatus, useDeleteAttachmentModalActions } from '~/states/ui/modal/delete-attachment';
import loggerFactory from '~/utils/logger';

import { Username } from '../../../components/User/Username';

import styles from './DeleteAttachmentModal.module.scss';

const logger = loggerFactory('growi:attachmentDelete');

const iconByFormat = (format: string): string => {
  return format.match(/image\/.+/i) ? 'image' : 'description';
};

/**
 * DeleteAttachmentModalSubstance - Presentation component (all logic here)
 */
type DeleteAttachmentModalSubstanceProps = {
  attachment: IAttachmentHasId | undefined;
  remove: ((args: { attachment_id: string }) => Promise<void>) | undefined;
  closeModal: () => void;
};

const DeleteAttachmentModalSubstance = ({
  attachment,
  remove,
  closeModal,
}: DeleteAttachmentModalSubstanceProps): React.JSX.Element => {
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>('');

  const { t } = useTranslation();

  const toggleHandler = useCallback(() => {
    closeModal();
    setDeleting(false);
    setDeleteError('');
  }, [closeModal]);

  const onClickDeleteButtonHandler = useCallback(async() => {
    if (remove == null || attachment == null) {
      return;
    }

    setDeleting(true);

    try {
      await remove({ attachment_id: attachment._id });
      setDeleting(false);
      closeModal();
      toastSuccess(`Delete ${attachment.originalName}`);
    }
    catch (err) {
      setDeleting(false);
      setDeleteError('Attachment could not be deleted.');
      toastError(err);
      logger.error(err);
    }
  }, [attachment, closeModal, remove]);

  const attachmentFileFormat = useMemo(() => {
    if (attachment == null) {
      return;
    }

    const content = (attachment.fileFormat.match(/image\/.+/i))
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={attachment.filePathProxied} alt="deleting image" />
      : '';

    return (
      <div className="attachment-delete-image">
        <p>
          <span className="material-symbols-outlined">{iconByFormat(attachment.fileFormat)}</span> {attachment.originalName}
        </p>
        <p>
          uploaded by <UserPicture user={attachment.creator} size="sm"></UserPicture> <Username user={attachment.creator}></Username>
        </p>
        {content}
      </div>
    );
  }, [attachment]);

  const deletingIndicator = useMemo(() => {
    if (deleting) {
      return <LoadingSpinner />;
    }
    if (deleteError) {
      return <span>{deleteError}</span>;
    }
    return <></>;
  }, [deleting, deleteError]);

  return (
    <div>
      <ModalHeader tag="h4" toggle={toggleHandler} className="text-danger">
        <span id="contained-modal-title-lg">{t('delete_attachment_modal.confirm_delete_attachment')}</span>
      </ModalHeader>
      <ModalBody>
        {attachmentFileFormat}
      </ModalBody>
      <ModalFooter>
        <div className="me-3 d-inline-block">
          {deletingIndicator}
        </div>
        <Button
          color="danger"
          onClick={onClickDeleteButtonHandler}
          disabled={deleting}
        >{t('commons:Delete')}
        </Button>
        <Button
          color="secondary"
          onClick={toggleHandler}
        >
          {t('modal_delete.cancel')}
        </Button>
      </ModalFooter>
    </div>
  );
};

/**
 * DeleteAttachmentModal - Container component (lightweight, always rendered)
 */
export const DeleteAttachmentModal: React.FC = () => {
  const deleteAttachmentModal = useDeleteAttachmentModalStatus();
  const { close: closeModal } = useDeleteAttachmentModalActions();
  const isOpen = deleteAttachmentModal?.isOpened;

  return (
    <Modal
      isOpen={isOpen}
      className={`${styles['attachment-delete-modal']} attachment-delete-modal`}
      size="lg"
      aria-labelledby="contained-modal-title-lg"
      fade={false}
    >
      {isOpen && (
        <DeleteAttachmentModalSubstance
          attachment={deleteAttachmentModal?.attachment}
          remove={deleteAttachmentModal?.remove}
          closeModal={closeModal}
        />
      )}
    </Modal>
  );
};
