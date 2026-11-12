import { type JSX, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';

import type { ChangeProposalView, OperationView } from '../../../../interfaces';
import { selectRevertibleOperations } from '../../domain';
import { revertOperations } from '../../stores/proposal-actions';
import type { RevertRun, RevertTarget } from './RevertResultList';

type RevertAllButtonProps = {
  readonly proposal: ChangeProposalView;
  readonly onReverted: (run: RevertRun) => void;
};

// Same path rule as OperationItem; a move is reverted from where it moved to.
const toRevertTarget = (operation: OperationView): RevertTarget => ({
  key: operation.key,
  path:
    operation.type === 'move'
      ? operation.toPath
      : (operation.page?.path ?? operation.path),
});

export const RevertAllButton = ({
  proposal,
  onReverted,
}: RevertAllButtonProps): JSX.Element | null => {
  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const revertibleOperations = useMemo(
    () => selectRevertibleOperations(proposal.operations),
    [proposal.operations],
  );

  // Non-null while the confirmation is open: the operations shown when the button was pressed.
  const [confirmTargets, setConfirmTargets] = useState<
    readonly RevertTarget[] | null
  >(null);
  const [isSending, setIsSending] = useState(false);
  // A second click can arrive before the re-render that disables the button.
  const isSendingRef = useRef(false);
  const [hasFailed, setHasFailed] = useState(false);

  if (isGuestUser || isReadOnlyUser || revertibleOperations.length === 0) {
    return null;
  }

  const open = (): void => {
    setHasFailed(false);
    setConfirmTargets(revertibleOperations.map(toRevertTarget));
  };

  const close = (): void => {
    if (!isSendingRef.current) {
      setConfirmTargets(null);
    }
  };

  const confirm = async (): Promise<void> => {
    if (confirmTargets == null || isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);
    const targets = confirmTargets;
    const sentKeys = targets.map((target) => target.key);
    try {
      const actionResult = await revertOperations(proposal.id, sentKeys);
      if (actionResult.type === 'done') {
        onReverted({ result: actionResult.result, targets, sentKeys });
      } else {
        setHasFailed(true);
      }
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
      setConfirmTargets(null);
    }
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        className="btn btn-outline-danger btn-sm"
        disabled={isSending}
        onClick={open}
      >
        {t('change_proposal_viewer.revert_all.button')}
      </button>
      {hasFailed && (
        <div className="alert alert-danger mt-2 mb-0">
          {t('change_proposal_viewer.revert_all.error')}
        </div>
      )}
      <Modal isOpen={confirmTargets != null} toggle={close}>
        <ModalHeader toggle={close}>
          {t('change_proposal_viewer.revert_all.confirm_title')}
        </ModalHeader>
        <ModalBody>
          <p>{t('change_proposal_viewer.revert_all.confirm_description')}</p>
          <ul className="mb-0">
            {confirmTargets?.map((target) => (
              <li key={target.key}>
                {target.path != null ? (
                  <code className="text-break">{target.path}</code>
                ) : (
                  <span className="text-muted">
                    {t('change_proposal_viewer.operation.page_gone')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            disabled={isSending}
            onClick={close}
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={isSending}
            onClick={confirm}
          >
            {t('change_proposal_viewer.revert_all.confirm_submit')}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
