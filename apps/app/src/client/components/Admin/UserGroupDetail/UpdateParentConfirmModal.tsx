import type { FC } from 'react';
import React, { useState } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { useUpdateUserGroupConfirmModalStatus, useUpdateUserGroupConfirmModalActions } from '~/states/ui/modal/update-user-group-confirm';


export const UpdateParentConfirmModal: FC = () => {
  const { t } = useTranslation();

  const [isForceUpdate, setForceUpdate] = useState(false);

  const modalStatus = useUpdateUserGroupConfirmModalStatus();
  const { close: closeModal } = useUpdateUserGroupConfirmModalActions();

  if (modalStatus == null) {
    closeModal();
    return <></>;
  }

  const {
    isOpened, targetGroup, updateData, onConfirm,
  } = modalStatus;

  return (
    <Modal className="modal-md" isOpen={isOpened} toggle={closeModal}>
      <ModalHeader tag="h4" toggle={closeModal} className="text-warning">
        <span className="material-symbols-outlined">warning</span> {t('admin:user_group_management.update_parent_confirm_modal.header')}
      </ModalHeader>
      {
        targetGroup != null && updateData != null ? (
          <>
            <ModalBody>
              <div className="mb-2">
                <span className="fw-bold">{t('admin:user_group_management.group_name')}</span> : &quot;{targetGroup.name}&quot;
                <hr />
                {t('admin:user_group_management.update_parent_confirm_modal.caution_change_parent', { groupName: targetGroup.name })}
              </div>
              <div className="text-danger mb-3">
                <span className="material-symbols-outlined">error</span>
                {t('admin:user_group_management.update_parent_confirm_modal.danger_message')}
              </div>

              <div className="form-check form-check-succsess ps-5">
                <input
                  className="form-check-input"
                  name="forceUpdateParents"
                  id="forceUpdateParents"
                  type="checkbox"
                  checked={isForceUpdate}
                  onChange={() => setForceUpdate(!isForceUpdate)}
                />
                <label className="form-label form-check-label" htmlFor="forceUpdateParents">
                  {t('admin:user_group_management.update_parent_confirm_modal.force_update_parents_label')}
                  <p className="form-text text-muted mt-0">{t('admin:user_group_management.update_parent_confirm_modal.force_update_parents_description')}</p>
                </label>
              </div>
            </ModalBody>
            <ModalFooter>
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => {
                  onConfirm?.(targetGroup, updateData, isForceUpdate);
                  closeModal();
                }}
              >
                {t('Confirm')}
              </button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalBody>
              <div>
                <span className="text-error">Something went wrong. Please try again.</span>
              </div>
            </ModalBody>
            <ModalFooter>
              <button type="button" onClick={() => closeModal()} className="btn btn-sm btn-secondary">
                {t('Cancel')}
              </button>
            </ModalFooter>
          </>
        )
      }
    </Modal>
  );
};
