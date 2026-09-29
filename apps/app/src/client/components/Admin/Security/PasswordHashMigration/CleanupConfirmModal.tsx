import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

type Props = {
  isOpen: boolean;
  isExecuting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/**
 * Confirmation for an irreversible operation.
 *
 * The consent checkbox guards the one consequence an administrator cannot undo and
 * would not otherwise see coming: after the cleanup the instance can no longer be
 * downgraded without mailing a password reset to every migrated user. The user-facing
 * risk is deliberately NOT part of this dialog — the server refuses to run while any
 * ACTIVE unmigrated user remains, so reaching this point already means nobody gets
 * locked out.
 */
export const CleanupConfirmModal = (props: Props): JSX.Element => {
  const { isOpen, isExecuting, onClose, onConfirm } = props;
  const { t } = useTranslation('admin');

  const [isConsented, setConsented] = useState(false);
  const consentId = useId();

  // Re-arm the consent every time the dialog is opened, so a previous session's
  // acknowledgement can never carry over into a new one.
  useEffect(() => {
    if (isOpen) {
      setConsented(false);
    }
  }, [isOpen]);

  const closeHandler = useCallback(() => {
    if (isExecuting) {
      return;
    }
    onClose();
  }, [isExecuting, onClose]);

  return (
    <Modal isOpen={isOpen} toggle={closeHandler}>
      <ModalHeader tag="h4" toggle={closeHandler} className="text-danger">
        <span className="material-symbols-outlined me-1">warning</span>
        {t('security_settings.password_hash_migration.cleanup_confirm_title')}
      </ModalHeader>
      <ModalBody>
        <p>
          {t('security_settings.password_hash_migration.cleanup_confirm_body')}
        </p>
        <div className="alert alert-warning">
          {t(
            'security_settings.password_hash_migration.cleanup_confirm_downgrade_warning',
          )}
        </div>
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            id={consentId}
            checked={isConsented}
            disabled={isExecuting}
            onChange={(e) => setConsented(e.target.checked)}
          />
          <label className="form-check-label" htmlFor={consentId}>
            {t('security_settings.password_hash_migration.cleanup_consent')}
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button onClick={closeHandler} disabled={isExecuting}>
          {t('Cancel')}
        </Button>
        <Button
          color="danger"
          onClick={onConfirm}
          disabled={!isConsented || isExecuting}
        >
          {isExecuting && (
            <span
              className="spinner-border spinner-border-sm me-1"
              role="status"
            />
          )}
          {t('security_settings.password_hash_migration.cleanup_execute')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
