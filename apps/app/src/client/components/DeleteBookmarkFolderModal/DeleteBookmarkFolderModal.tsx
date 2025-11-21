
import type { FC } from 'react';
import { useCallback } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalBody, ModalFooter, ModalHeader,
} from 'reactstrap';

import { FolderIcon } from '~/client/components/Icons/FolderIcon';
import { deleteBookmarkFolder } from '~/client/util/bookmark-utils';
import { toastError } from '~/client/util/toastr';
import type { BookmarkFolderItems } from '~/interfaces/bookmark-info';
import { useDeleteBookmarkFolderModalStatus, useDeleteBookmarkFolderModalActions } from '~/states/ui/modal/delete-bookmark-folder';

/**
 * DeleteBookmarkFolderModalSubstance - Presentation component (all logic here)
 */
type DeleteBookmarkFolderModalSubstanceProps = {
  bookmarkFolder: BookmarkFolderItems;
  onDeleted?: (folderId: string) => void;
  closeModal: () => void;
};

const DeleteBookmarkFolderModalSubstance = ({
  bookmarkFolder,
  onDeleted,
  closeModal,
}: DeleteBookmarkFolderModalSubstanceProps): React.JSX.Element => {
  const { t } = useTranslation();

  const deleteBookmark = useCallback(async() => {
    try {
      await deleteBookmarkFolder(bookmarkFolder._id);
      if (onDeleted != null) {
        onDeleted(bookmarkFolder._id);
      }
      closeModal();
    }
    catch (err) {
      toastError(err);
    }
  }, [bookmarkFolder, onDeleted, closeModal]);

  const onClickDeleteButton = useCallback(async() => {
    await deleteBookmark();
  }, [deleteBookmark]);

  return (
    <div>
      <ModalHeader tag="h4" toggle={closeModal} className="text-danger">
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
    </div>
  );
};

/**
 * DeleteBookmarkFolderModal - Container component (lightweight, always rendered)
 */
const DeleteBookmarkFolderModal: FC = () => {
  const { isOpened, bookmarkFolder, opts } = useDeleteBookmarkFolderModalStatus();
  const { close: closeModal } = useDeleteBookmarkFolderModalActions();

  return (
    <Modal size="md" isOpen={isOpened} toggle={closeModal} data-testid="page-delete-modal" className="grw-create-page">
      {isOpened && bookmarkFolder != null && (
        <DeleteBookmarkFolderModalSubstance
          bookmarkFolder={bookmarkFolder}
          onDeleted={opts?.onDeleted}
          closeModal={closeModal}
        />
      )}
    </Modal>
  );
};

export { DeleteBookmarkFolderModal };
