import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import type { TransferPreflightResult } from '~/interfaces/g2g-transfer';
import type { TransferPreset } from '~/models/admin/g2g-transfer-preset';

type TransferWarning = TransferPreflightResult['warnings'][number];

/**
 * Translation key for each {@link TransferWarning}'s `type`. Keyed by the discriminant
 * itself rather than built by the server: the preflight response carries `type` values,
 * not rendered sentences (design.md's Implementation Notes -- "クライアント側で type に応じて
 * 翻訳する" -- is the option this component takes).
 *
 * The mapped type, rather than a `Record<string, string>`, makes a new `TransferWarning`
 * variant a compile error here until this map is taught about it.
 */
const WARNING_TRANSLATION_KEY: {
  readonly [T in TransferWarning['type']]: string;
} = {
  password_seed_mismatch:
    'g2g_data_transfer.confirm_modal.warnings.password_seed_mismatch',
  no_loginable_admin:
    'g2g_data_transfer.confirm_modal.warnings.no_loginable_admin',
  sessions_not_invalidatable:
    'g2g_data_transfer.confirm_modal.warnings.sessions_not_invalidatable',
  local_auth_disabled_at_source:
    'g2g_data_transfer.confirm_modal.warnings.local_auth_disabled_at_source',
};

interface G2GTransferConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /**
   * What the pushing server's `/preflight` endpoint reported (requirements 3.1, 3.4,
   * 3.5, 3.7) -- counts and warnings only, never rendered text. `null` before the
   * check has returned; the caller is expected to keep `isOpen` false until this is
   * populated, so callers never need to render a loading state here.
   */
  preflightResult: TransferPreflightResult | null;
  /**
   * Which preset the operator picked. Requirements 3.1/3.2 are scoped to "migration" --
   * under "merge" nothing on the destination is deleted (requirement 6.1 keeps legacy
   * behavior unchanged, and since task 10.1 the screen cannot even assign replace to
   * `users`/`usergroups` there), so the deletion description and counts must only
   * render under "migration". A destructive-action confirmation that claims data will
   * be deleted when it will not is worse than no confirmation at all.
   */
  transferPreset: TransferPreset;
}

/**
 * Asks the operator to confirm a transfer, showing what it will delete on the
 * destination and any conditions they must accept first (requirements 3.1-3.3). Nothing
 * about the transfer -- archive generation or the request to the destination -- happens
 * until `onConfirm` is called.
 *
 * Also carries the maintenance-mode notice that used to be a separate modal
 * (`MaintenanceModeNoticeModal`, task 4.4): the destination stays in maintenance mode
 * after the transfer, and the operator has to switch it off themselves from the
 * destination's own admin screen. Task 4.4 named this modal as the place that notice
 * would fold into once it existed, so there is one confirmation step here, not two in
 * sequence. The zip-import screen (`ImportForm.jsx`) is a separate entry point and keeps
 * using `MaintenanceModeNoticeModal` on its own -- this component does not replace that
 * usage.
 */
export const G2GTransferConfirmModal = ({
  isOpen,
  onClose,
  onConfirm,
  preflightResult,
  transferPreset,
}: G2GTransferConfirmModalProps): JSX.Element => {
  const { t } = useTranslation('admin');

  const destinationCounts = preflightResult?.destinationCounts;
  const warnings = preflightResult?.warnings ?? [];
  // Requirements 3.1/3.2/6.1: only "migration" replaces the destination's data, so
  // only "migration" gets to say so. "merge" always leaves the destination's existing
  // data in place -- the warnings list and the maintenance-mode notice below still
  // apply to both presets (requirement 6.3, requirement 2.10).
  const isMigration = transferPreset === 'migration';

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      <ModalHeader toggle={onClose}>
        {t('g2g_data_transfer.confirm_modal.title')}
      </ModalHeader>
      <ModalBody>
        {isMigration && (
          <>
            <p className="mb-2">
              {t('g2g_data_transfer.confirm_modal.description')}
            </p>
            <ul className="mb-3">
              <li>{`${t('g2g_data_transfer.confirm_modal.counts.users')}: ${destinationCounts?.users ?? 0}`}</li>
              <li>{`${t('g2g_data_transfer.confirm_modal.counts.user_groups')}: ${destinationCounts?.userGroups ?? 0}`}</li>
              <li>{`${t('g2g_data_transfer.confirm_modal.counts.pages')}: ${destinationCounts?.pages ?? 0}`}</li>
            </ul>
          </>
        )}

        {warnings.length > 0 && (
          <div className="alert alert-warning" role="alert">
            <p className="mb-1">
              {t('g2g_data_transfer.confirm_modal.warnings_heading')}
            </p>
            <ul className="mb-0">
              {warnings.map((warning) => (
                <li key={warning.type}>
                  {t(WARNING_TRANSLATION_KEY[warning.type])}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mb-2 mt-3">
          {t('maintenance_mode_notice.body_destination')}
        </p>
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
