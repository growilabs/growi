import type React from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import type { SelectablePage } from '../../../../interfaces/selectable-page';

/**
 * ShareScopeWarningModalSubstance - Presentation component (all logic here)
 */
type ShareScopeWarningModalSubstanceProps = {
  selectedPages: SelectablePage[];
  closeModal: () => void;
  onSubmit: () => Promise<void>;
};

const ShareScopeWarningModalSubstance = ({
  selectedPages,
  closeModal,
  onSubmit,
}: ShareScopeWarningModalSubstanceProps): React.JSX.Element => {
  const { t } = useTranslation();

  const upsertAiAssistantHandler = useCallback(() => {
    closeModal();
    onSubmit();
  }, [closeModal, onSubmit]);

  // Memoize selected pages list
  const selectedPagesList = useMemo(() => {
    return selectedPages.map((selectedPage) => (
      <code key={selectedPage.path}>{selectedPage.path}</code>
    ));
  }, [selectedPages]);

  return (
    <div>
      <ModalHeader toggle={closeModal}>
        <div className="d-flex align-items-center">
          <span className="material-symbols-outlined text-warning me-2 fs-4">
            warning
          </span>
          <span className="text-warning fw-bold">
            {t('share_scope_warning_modal.header_title')}
          </span>
        </div>
      </ModalHeader>

      <ModalBody className="py-4 px-4">
        <p
          className="mb-4"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
          dangerouslySetInnerHTML={{
            __html: t('share_scope_warning_modal.warning_message'),
          }}
        />

        <div className="mb-4">
          <p className="mb-2 text-secondary">
            {t('share_scope_warning_modal.selected_pages_label')}
          </p>
          {selectedPagesList}
        </div>

        <p>{t('share_scope_warning_modal.confirmation_message')}</p>
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
    </div>
  );
};

/**
 * ShareScopeWarningModal - Container component (lightweight, always rendered)
 */
type Props = {
  isOpen: boolean;
  selectedPages: SelectablePage[];
  closeModal: () => void;
  onSubmit: () => Promise<void>;
};

export const ShareScopeWarningModal = (props: Props): React.JSX.Element => {
  const { isOpen, selectedPages, closeModal, onSubmit } = props;

  return (
    <Modal size="lg" isOpen={isOpen} toggle={closeModal}>
      {isOpen && (
        <ShareScopeWarningModalSubstance
          selectedPages={selectedPages}
          closeModal={closeModal}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
};
