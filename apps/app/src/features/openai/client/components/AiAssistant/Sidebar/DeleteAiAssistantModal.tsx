import type React from 'react';
import { useTranslation } from 'next-i18next';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import type { AiAssistantHasId } from '../../../../interfaces/ai-assistant';

export type DeleteAiAssistantModalProps = {
  isShown: boolean;
  aiAssistant: AiAssistantHasId | null;
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export const DeleteAiAssistantModal: React.FC<DeleteAiAssistantModalProps> = ({
  isShown,
  aiAssistant,
  errorMessage,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();

  const headerContent = () => {
    if (!isShown || aiAssistant == null) {
      return null;
    }
    return (
      <>
        <span className="material-symbols-outlined me-1">delete_forever</span>
        <span className="fw-bold">
          {t('ai_assistant_substance.delete_modal.title')}
        </span>
      </>
    );
  };

  const bodyContent = () => {
    if (!isShown || aiAssistant == null) {
      return null;
    }
    return (
      <p className="fw-bold mb-0">
        {t('ai_assistant_substance.delete_modal.confirm_message')}
      </p>
    );
  };

  const footerContent = () => {
    if (!isShown || aiAssistant == null) {
      return null;
    }
    return (
      <>
        {errorMessage && <span className="text-danger">{errorMessage}</span>}
        <Button color="outline-neutral-secondary" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button color="danger" onClick={onConfirm}>
          {t('Delete')}
        </Button>
      </>
    );
  };

  return (
    <Modal isOpen={isShown} toggle={onCancel} centered>
      <ModalHeader tag="h5" toggle={onCancel} className="text-danger px-4">
        {headerContent()}
      </ModalHeader>
      <ModalBody className="px-4">{bodyContent()}</ModalBody>
      <ModalFooter className="px-4 gap-2">{footerContent()}</ModalFooter>
    </Modal>
  );
};
