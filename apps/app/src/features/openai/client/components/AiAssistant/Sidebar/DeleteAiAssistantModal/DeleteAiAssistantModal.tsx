import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'next-i18next';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import type { AiAssistantHasId } from '../../../../../interfaces/ai-assistant';

export type DeleteAiAssistantModalProps = {
  isShown: boolean;
  aiAssistant: AiAssistantHasId | null;
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * DeleteAiAssistantModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
type DeleteAiAssistantModalSubstanceProps = {
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

const DeleteAiAssistantModalSubstance: React.FC<
  DeleteAiAssistantModalSubstanceProps
> = ({ errorMessage, onCancel, onConfirm }) => {
  const { t } = useTranslation();

  // Memoize header content
  const headerContent = useMemo(
    () => (
      <>
        <span className="material-symbols-outlined me-1">delete_forever</span>
        <span className="fw-bold">
          {t('ai_assistant_substance.delete_modal.title')}
        </span>
      </>
    ),
    [t],
  );

  // Memoize body content
  const bodyContent = useMemo(
    () => (
      <p className="fw-bold mb-0">
        {t('ai_assistant_substance.delete_modal.confirm_message')}
      </p>
    ),
    [t],
  );

  // Memoize footer content
  const footerContent = useMemo(
    () => (
      <>
        {errorMessage && <span className="text-danger">{errorMessage}</span>}
        <Button color="outline-neutral-secondary" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button color="danger" onClick={onConfirm}>
          {t('Delete')}
        </Button>
      </>
    ),
    [errorMessage, onCancel, onConfirm, t],
  );

  return (
    <>
      <ModalHeader tag="h5" toggle={onCancel} className="text-danger px-4">
        {headerContent}
      </ModalHeader>
      <ModalBody className="px-4">{bodyContent}</ModalBody>
      <ModalFooter className="px-4 gap-2">{footerContent}</ModalFooter>
    </>
  );
};

/**
 * DeleteAiAssistantModal - Container component (lightweight, always rendered)
 */
export const DeleteAiAssistantModal: React.FC<DeleteAiAssistantModalProps> = ({
  isShown,
  aiAssistant,
  errorMessage,
  onCancel,
  onConfirm,
}) => {
  return (
    <Modal isOpen={isShown} toggle={onCancel} centered>
      {isShown && aiAssistant != null && (
        <DeleteAiAssistantModalSubstance
          errorMessage={errorMessage}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </Modal>
  );
};
