import type { FC } from 'react';
import React, { useState, useCallback, useMemo } from 'react';

import type { IPageToDeleteWithMeta } from '@growi/core';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { apiv3Delete } from '~/client/util/apiv3-client';
import { useEmptyTrashModalStatus, useEmptyTrashModalActions } from '~/states/ui/modal/empty-trash';

import ApiErrorMessageList from './PageManagement/ApiErrorMessageList';

/**
 * EmptyTrashModalSubstance - Presentation component (all logic here)
 */
type EmptyTrashModalSubstanceProps = {
  pages: IPageToDeleteWithMeta[] | undefined;
  canDeleteAllPages: boolean;
  onEmptiedTrash?: () => void;
  closeModal: () => void;
};

const EmptyTrashModalSubstance = ({
  pages,
  canDeleteAllPages,
  onEmptiedTrash,
  closeModal,
}: EmptyTrashModalSubstanceProps): React.JSX.Element => {
  const { t } = useTranslation();

  const [errs, setErrs] = useState<Error[] | null>(null);

  const emptyTrash = useCallback(async() => {
    if (pages == null) {
      return;
    }

    try {
      await apiv3Delete('/pages/empty-trash');
      if (onEmptiedTrash != null) {
        onEmptiedTrash();
      }
      closeModal();
    }
    catch (err) {
      setErrs([err]);
    }
  }, [pages, onEmptiedTrash, closeModal]);

  const emptyTrashButtonHandler = useCallback(async() => {
    await emptyTrash();
  }, [emptyTrash]);

  // Memoize page paths rendering
  const renderPagePaths = useMemo(() => {
    if (pages != null) {
      return pages.map(page => (
        <p key={page.data._id} className="mb-1">
          <code>{ page.data.path }</code>
        </p>
      ));
    }
    return <></>;
  }, [pages]);

  return (
    <div>
      <ModalHeader tag="h4" toggle={closeModal} className="text-danger">
        <span className="material-symbols-outlined">delete_forever</span>
        {t('modal_empty.empty_the_trash')}
      </ModalHeader>
      <ModalBody>
        <div className="grw-scrollable-modal-body pb-1">
          <label className="form-label">{ t('modal_delete.deleting_page') }:</label><br />
          {/* Todo: change the way to show path on modal when too many pages are selected */}
          {renderPagePaths}
        </div>
        {!canDeleteAllPages && t('modal_empty.not_deletable_notice')}<br />
        {t('modal_empty.notice')}
      </ModalBody>
      <ModalFooter>
        <ApiErrorMessageList errs={errs} />
        <button
          type="button"
          className="btn btn-danger"
          onClick={emptyTrashButtonHandler}
        >
          <span className="material-symbols-outlined" aria-hidden="true">delete_forever</span>
          {t('modal_empty.empty_the_trash_button')}
        </button>
      </ModalFooter>
    </div>
  );
};

/**
 * EmptyTrashModal - Container component (lightweight, always rendered)
 */
const EmptyTrashModal: FC = () => {
  const { isOpened, pages, opts } = useEmptyTrashModalStatus();
  const { close: closeModal } = useEmptyTrashModalActions();

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeModal} data-testid="page-delete-modal">
      {isOpened && (
        <EmptyTrashModalSubstance
          pages={pages}
          canDeleteAllPages={opts?.canDeleteAllPages ?? false}
          onEmptiedTrash={opts?.onEmptiedTrash}
          closeModal={closeModal}
        />
      )}
    </Modal>
  );
};

export default EmptyTrashModal;
