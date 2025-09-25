import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'react-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import type { SelectablePage } from '../../../../interfaces/selectable-page';

type Props = {
  isOpen: boolean,
  selectedPages: SelectablePage[],
  closeModal: () => void,
  onSubmit: () => Promise<void>,
}

export const ShareScopeWarningModal = (props: Props): JSX.Element => {
  const {
    isOpen,
    selectedPages,
    closeModal,
    onSubmit,
  } = props;

  const { t } = useTranslation();

  const upsertAiAssistantHandler = useCallback(() => {
    closeModal();
    onSubmit();
  }, [closeModal, onSubmit]);

  return (
    <Modal size="lg" isOpen={isOpen} toggle={closeModal}>
      <ModalHeader toggle={closeModal}>
        <div className="d-flex align-items-center">
          <span className="material-symbols-outlined text-warning me-2 fs-4">warning</span>
          <span className="text-warning fw-bold">{t('share_scope_warning_modal.header_title')}</span>
        </div>
      </ModalHeader>

      <ModalBody className="py-4 px-4">
        <p
          className="mb-4"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: t('share_scope_warning_modal.warning_message') }}
        />

        <div className="mb-4">
          <p className="mb-2 text-secondary">{t('share_scope_warning_modal.selected_pages_label')}</p>
          {selectedPages.map(selectedPage => (
            <code key={selectedPage.path}>
              {selectedPage.path}
            </code>
          ))}
        </div>

        <p>
          {t('share_scope_warning_modal.confirmation_message')}
        </p>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={closeModal}
        >
          {t('share_scope_warning_modal.button.review')}
        </button>

        <button
          type="button"
          className="btn btn-warning"
          onClick={upsertAiAssistantHandler}
        >
          {t('share_scope_warning_modal.button.proceed')}
        </button>
      </ModalFooter>
    </Modal>
  );
};
