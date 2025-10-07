
import type { FC } from 'react';
import { useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalBody, ModalFooter, ModalHeader,
} from 'reactstrap';

import { FolderIcon } from '~/client/components/Icons/FolderIcon';
import { deleteBookmarkFolder } from '~/client/util/bookmark-utils';
import { toastError } from '~/client/util/toastr';
import { useDeleteBookmarkFolderModalStatus, useDeleteBookmarkFolderModalActions } from '~/states/ui/modal/delete-bookmark-folder';


const DeleteBookmarkFolderModal: FC = () => {
  const { t } = useTranslation();

  const { isOpened, bookmarkFolder, opts } = useDeleteBookmarkFolderModalStatus();
  const { close: closeBookmarkFolderDeleteModal } = useDeleteBookmarkFolderModalActions();

  const deleteBookmark = useCallback(async() => {
    if (bookmarkFolder == null) {
      return;
    }
    try {
      await deleteBookmarkFolder(bookmarkFolder._id);
      const onDeleted = opts?.onDeleted;
      if (onDeleted != null) {
        onDeleted(bookmarkFolder._id);
      }
      closeBookmarkFolderDeleteModal();
    }
    catch (err) {
      toastError(err);
    }
  }, [bookmarkFolder, closeBookmarkFolderDeleteModal, opts?.onDeleted]);

  const onClickDeleteButton = useCallback(async() => {
    await deleteBookmark();
  }, [deleteBookmark]);

  return (
    <Modal size="md" isOpen={isOpened} toggle={closeBookmarkFolderDeleteModal} data-testid="page-delete-modal" className="grw-create-page">
      <ModalHeader tag="h4" toggle={closeBookmarkFolderDeleteModal} className="text-danger">
        <span className="material-symbols-outlined">delete</span>
        {t('bookmark_folder.delete_modal.modal_header_label')}
      </ModalHeader>
      <ModalBody>
        <div className="pb-1 text-break">
          <label className="form-label">{ t('bookmark_folder.delete_modal.modal_body_description') }:</label><br />
          <FolderIcon isOpen={false} /> {bookmarkFolder?.name}
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
