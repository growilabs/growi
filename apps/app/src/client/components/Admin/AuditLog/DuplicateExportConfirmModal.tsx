import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onRestart: () => void;
};

export const DuplicateExportConfirmModal = ({
  isOpen,
  onClose,
  onRestart,
}: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      <ModalHeader tag="h4" toggle={onClose}>
        {t('audit_log_management.confirm_export')}
      </ModalHeader>
      <ModalBody>
        {t('audit_log_management.duplicate_export_confirm')}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onClose}
        >
          {t('export_management.cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onRestart}>
          {t('audit_log_management.restart_export')}
        </button>
      </ModalFooter>
    </Modal>
  );
};
