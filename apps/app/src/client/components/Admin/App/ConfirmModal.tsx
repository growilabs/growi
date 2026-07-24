import type { FC } from 'react';
import React from 'react';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

type ConfirmModalProps = {
  isModalOpen: boolean;
  warningMessage: string;
  supplymentaryMessage: string | null;
  confirmButtonTitle: string;
  // Optional overrides; defaults keep the original "Warning" appearance so
  // existing callers are unaffected.
  title?: string;
  cancelButtonTitle?: string;
  headerClassName?: string;
  iconName?: string;
  // The modal ignores the return value, so sync handlers are fine too —
  // demanding a Promise would force callers into no-await async functions.
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
};

export const ConfirmModal: FC<ConfirmModalProps> = (
  props: ConfirmModalProps,
) => {
  const { t } = useTranslation();

  const {
    title,
    cancelButtonTitle,
    headerClassName = 'text-danger',
    iconName = 'warning',
  } = props;

  const onCancel = () => {
    if (props.onCancel != null) {
      props.onCancel();
    }
  };

  const onConfirm = () => {
    if (props.onConfirm != null) {
      props.onConfirm();
    }
  };

  return (
    <Modal isOpen={props.isModalOpen} toggle={onCancel}>
      <ModalHeader tag="h4" toggle={onCancel} className={headerClassName}>
        <span className="material-symbols-outlined me-1">{iconName}</span>
        {title ?? t('Warning')}
      </ModalHeader>
      <ModalBody>
        {props.warningMessage}
        {props.supplymentaryMessage != null && (
          <>
            <br />
            <br />
            <span className="text-warning">
              <>
                <span className="material-symbols-outlined">error</span>
                {props.supplymentaryMessage}
              </>
            </span>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onCancel}
        >
          {cancelButtonTitle ?? t('Cancel')}
        </button>
        <button
          type="button"
          className="btn btn-outline-primary ms-3"
          onClick={onConfirm}
        >
          {props.confirmButtonTitle ?? t('Confirm')}
        </button>
      </ModalFooter>
    </Modal>
  );
};
