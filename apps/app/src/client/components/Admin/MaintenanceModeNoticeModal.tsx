import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

/**
 * Warns the operator, before an import or a transfer starts, that it will leave GROWI in
 * maintenance mode and that switching it back off is their job.
 *
 * Importing the configs collection replaces every setting with the archive's, so the
 * import closes GROWI and deliberately does not reopen it (requirement 2.9). Nothing in
 * the server tells the operator that afterwards — by then the screen they are looking at
 * may not even be the GROWI that closed — so the warning has to come first.
 *
 * Shared by both entry points so the two never drift into saying different things.
 */
interface MaintenanceModeNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /**
   * True when the GROWI that will close is a different one from the one the operator is
   * looking at — a transfer. Decides whether the text talks about "this GROWI" or "the
   * destination GROWI", and whose admin screen the operator has to go to afterwards.
   */
  isDestinationRemote?: boolean;
}

export const MaintenanceModeNoticeModal = ({
  isOpen,
  onClose,
  onConfirm,
  isDestinationRemote = false,
}: MaintenanceModeNoticeModalProps): JSX.Element => {
  const { t } = useTranslation('admin');

  const bodyKey = isDestinationRemote
    ? 'maintenance_mode_notice.body_destination'
    : 'maintenance_mode_notice.body_this_growi';

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      <ModalHeader toggle={onClose}>
        {t('maintenance_mode_notice.title')}
      </ModalHeader>
      <ModalBody>
        <p className="mb-2">{t(bodyKey)}</p>
        <p className="mb-0">{t('maintenance_mode_notice.turn_it_off')}</p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onClose}
        >
          {t('maintenance_mode_notice.cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {t('maintenance_mode_notice.proceed')}
        </button>
      </ModalFooter>
    </Modal>
  );
};
