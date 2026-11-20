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
import { SymbolIcon } from '../SymbolIcon';

import styles from './RevertActions.module.scss';

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
  const messageHintId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  // A second click can arrive before the re-render that disables the button.
  const isSendingRef = useRef(false);
  const [result, setResult] = useState<RevertRequestResult | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

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

  // A fragment so the button sits directly in the parent's action row.
  return (
    <>
      <button
        type="button"
        className={`btn btn-outline-secondary ${styles['action-button']}`}
        onClick={open}
      >
        <SymbolIcon name="forward_to_inbox" className={styles['action-icon']} />
        {t('change_proposal_viewer.revert_request.button')}
      </button>
      <Modal
        isOpen={isOpen}
        toggle={close}
        autoFocus={false}
        onOpened={() => messageRef.current?.focus()}
      >
        <ModalHeader toggle={close}>
          {t('change_proposal_viewer.revert_request.modal_title')}
        </ModalHeader>
        <ModalBody>
          <label htmlFor={messageId} className="form-label">
            {t('change_proposal_viewer.revert_request.message_label')}
          </label>
          <textarea
            ref={messageRef}
            id={messageId}
            className={`form-control ${isTooLong ? 'is-invalid' : ''}`}
            rows={4}
            value={message}
            disabled={isSending || isSent}
            aria-invalid={isTooLong}
            aria-describedby={isTooLong ? messageHintId : undefined}
            onChange={(e) => setMessage(e.target.value)}
          />
          {isTooLong && (
            <div id={messageHintId} className="invalid-feedback d-block">
              {t('change_proposal_viewer.revert_request.message_too_long')}
            </div>
          )}
          {result != null && (
            <div
              role={isSent ? 'status' : 'alert'}
              className={`alert ${isSent ? 'alert-success' : 'alert-danger'} d-flex align-items-start gap-2 mt-3 mb-0`}
            >
              <SymbolIcon
                name={isSent ? 'check_circle' : 'error'}
                className={styles['action-icon']}
              />
              <div>
                {t(
                  `change_proposal_viewer.revert_request.result.${toResultKey(result)}`,
                )}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={isSending}
            onClick={close}
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isSending || isTooLong || isSent}
            onClick={submit}
          >
            {isSending && (
              <span
                className="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
              />
            )}
            {t('change_proposal_viewer.revert_request.submit')}
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
};
