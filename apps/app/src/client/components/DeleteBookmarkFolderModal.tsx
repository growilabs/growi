
import type { FC } from 'react';
import React from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalBody, ModalFooter, ModalHeader,
} from 'reactstrap';

import { deleteBookmarkFolder } from '~/client/util/bookmark-utils';
import { toastError } from '~/client/util/toastr';
import { FolderIcon } from '~/client/components/Icons/FolderIcon';
import { useBookmarkFolderDeleteModal } from '~/stores/modal';


const DeleteBookmarkFolderModal: FC = () => {
  const { t } = useTranslation();
  const { data: deleteBookmarkFolderModalData, close: closeBookmarkFolderDeleteModal } = useBookmarkFolderDeleteModal();
  const isOpened = deleteBookmarkFolderModalData?.isOpened ?? false;

  async function deleteBookmark() {
    if (deleteBookmarkFolderModalData == null || deleteBookmarkFolderModalData.bookmarkFolder == null) {
      return;
    }
    if (deleteBookmarkFolderModalData.bookmarkFolder != null) {
      try {
        await deleteBookmarkFolder(deleteBookmarkFolderModalData.bookmarkFolder._id);
        const onDeleted = deleteBookmarkFolderModalData.opts?.onDeleted;
        if (onDeleted != null) {
          onDeleted(deleteBookmarkFolderModalData.bookmarkFolder._id);
        }
        closeBookmarkFolderDeleteModal();
      }
      catch (err) {
        toastError(err);
      }
    }
  }
  async function onClickDeleteButton() {
    await deleteBookmark();
  }

  return (
    <Modal size="md" isOpen={isOpened} toggle={closeBookmarkFolderDeleteModal} data-testid="page-delete-modal" className="grw-create-page">
      <ModalHeader tag="h4" toggle={closeBookmarkFolderDeleteModal} className="text-danger">
        <span className="material-symbols-outlined">delete</span>
        {t('bookmark_folder.delete_modal.modal_header_label')}
      </ModalHeader>
      <ModalBody>
        <div className="pb-1 text-break">
          <label className="form-label">{ t('bookmark_folder.delete_modal.modal_body_description') }:</label><br />
          <FolderIcon isOpen={false} /> {deleteBookmarkFolderModalData?.bookmarkFolder?.name}
        </div>
        {t('bookmark_folder.delete_modal.modal_body_alert')}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-danger"
          onClick={onClickDeleteButton}
        >
          <span className="material-symbols-outlined" aria-hidden="true">delete</span>
          {t('bookmark_folder.delete_modal.modal_footer_button')}
        </button>
      </ModalFooter>
    </Modal>

  );
};

export { DeleteBookmarkFolderModal };
