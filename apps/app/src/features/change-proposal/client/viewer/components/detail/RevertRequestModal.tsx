import { type JSX, useId, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';

import type { ChangeProposalView } from '../../../../interfaces';
import {
  countRevertRequestMessageLength,
  REVERT_REQUEST_MESSAGE_MAX_LENGTH,
} from '../../../../interfaces';
import type { RevertRequestResult } from '../../stores/proposal-actions';
import { sendRevertRequest } from '../../stores/proposal-actions';

type RevertRequestModalProps = { readonly proposal: ChangeProposalView };

const ERROR_CODE_RESULT_KEYS = {
  'not-found': 'not_found',
  'message-too-long': 'too_long',
  'recently-requested': 'recently_sent',
  'own-proposal': 'own_proposal',
  'requester-unavailable': 'requester_unavailable',
  unknown: 'error',
} as const satisfies Record<
  Extract<RevertRequestResult, { type: 'error' }>['code'],
  string
>;

const toResultKey = (result: RevertRequestResult): string =>
  result.type === 'sent' ? 'sent' : ERROR_CODE_RESULT_KEYS[result.code];

export const RevertRequestModal = ({
  proposal,
}: RevertRequestModalProps): JSX.Element | null => {
  const { t } = useTranslation();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const messageId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  // A second click can arrive before the re-render that disables the button.
  const isSendingRef = useRef(false);
  const [result, setResult] = useState<RevertRequestResult | null>(null);

  if (proposal.isRequester || isGuestUser || isReadOnlyUser) {
    return null;
  }

  const isTooLong =
    countRevertRequestMessageLength(message) >
    REVERT_REQUEST_MESSAGE_MAX_LENGTH;
  const isSent = result?.type === 'sent';

  const open = (): void => {
    setMessage('');
    setResult(null);
    setIsOpen(true);
  };

  const close = (): void => {
    if (!isSendingRef.current) {
      setIsOpen(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (isSendingRef.current || isTooLong) {
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);
    setResult(null);
    try {
      setResult(await sendRevertRequest(proposal.id, message));
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={open}
      >
        {t('change_proposal_viewer.revert_request.button')}
      </button>
      <Modal isOpen={isOpen} toggle={close}>
        <ModalHeader toggle={close}>
          {t('change_proposal_viewer.revert_request.modal_title')}
        </ModalHeader>
        <ModalBody>
          <label htmlFor={messageId} className="form-label">
            {t('change_proposal_viewer.revert_request.message_label')}
          </label>
          <textarea
            id={messageId}
            className={`form-control ${isTooLong ? 'is-invalid' : ''}`}
            rows={4}
            value={message}
            disabled={isSending || isSent}
            onChange={(e) => setMessage(e.target.value)}
          />
          {isTooLong && (
            <div className="text-danger small mt-1">
              {t('change_proposal_viewer.revert_request.message_too_long')}
            </div>
          )}
          {result != null && (
            <div
              className={`alert ${isSent ? 'alert-success' : 'alert-danger'} mt-3 mb-0`}
            >
              {t(
                `change_proposal_viewer.revert_request.result.${toResultKey(result)}`,
              )}
            </div>
          )}
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
            className="btn btn-sm btn-primary"
            disabled={isSending || isTooLong || isSent}
            onClick={submit}
          >
            {t('change_proposal_viewer.revert_request.submit')}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
