import { type JSX, useCallback, useState } from 'react';
import { Modal, ModalHeader } from 'reactstrap';

import { PairingForm } from './PairingForm';

/**
 * The "Connections" heading together with the "Add connection" entry point:
 * a button that opens the pairing form in a modal. The button is disabled
 * while the encryption key is unconfigured; the reason is shown by
 * `EncryptionKeyWarning` at the top of the screen.
 */
export const PairingSection = ({
  encryptionConfigured,
  onPaired,
}: {
  encryptionConfigured: boolean;
  onPaired: () => void;
}): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const handlePaired = useCallback(() => {
    setIsOpen(false);
    onPaired();
  }, [onPaired]);

  return (
    <div className="mb-3" data-testid="grw-chat-integration-pairing-section">
      <div className="d-flex justify-content-between align-items-center">
        <h2 className="admin-setting-header mb-0">Connections</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleOpen}
          disabled={!encryptionConfigured}
        >
          Add connection
        </button>
      </div>

      <Modal isOpen={isOpen} toggle={handleClose}>
        <ModalHeader toggle={handleClose}>Add connection</ModalHeader>
        <PairingForm
          encryptionConfigured={encryptionConfigured}
          onPaired={handlePaired}
          onCancel={handleClose}
        />
      </Modal>
    </div>
  );
};
