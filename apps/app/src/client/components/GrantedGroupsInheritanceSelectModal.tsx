import { useState, type JSX } from 'react';

import { useTranslation } from 'react-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { useGrantedGroupsInheritanceSelectModal } from '~/stores/modal';

const GrantedGroupsInheritanceSelectModal = (): JSX.Element => {
  const { t } = useTranslation();
  const { data: modalData, close: closeModal } = useGrantedGroupsInheritanceSelectModal();
  const [onlyInheritUserRelatedGrantedGroups, setOnlyInheritUserRelatedGrantedGroups] = useState(false);

  const onCreateBtnClick = async() => {
    await modalData?.onCreateBtnClick?.(onlyInheritUserRelatedGrantedGroups);
    setOnlyInheritUserRelatedGrantedGroups(false); // reset to false after create request
  };
  const isOpened = modalData?.isOpened ?? false;

  return (
    <Modal
      isOpen={isOpened}
      toggle={() => closeModal()}
    >
      <ModalHeader tag="h4" toggle={() => closeModal()}>
        {t('modal_granted_groups_inheritance_select.select_granted_groups')}
      </ModalHeader>
      <ModalBody>
        <div className="px-3 pt-3">
          <div className="form-check radio-primary mb-3">
            <input
              type="radio"
              id="inheritAllGroupsRadio"
              className="form-check-input"
              form="formImageType"
              checked={!onlyInheritUserRelatedGrantedGroups}
              onChange={() => { setOnlyInheritUserRelatedGrantedGroups(false) }}
            />
            <label className="form-check-label" htmlFor="inheritAllGroupsRadio">
              {t('modal_granted_groups_inheritance_select.inherit_all_granted_groups_from_parent')}
            </label>
          </div>
          <div className="form-check radio-primary">
            <input
              type="radio"
              id="onlyInheritRelatedGroupsRadio"
              className="form-check-input"
              form="formImageType"
              checked={onlyInheritUserRelatedGrantedGroups}
              onChange={() => { setOnlyInheritUserRelatedGrantedGroups(true) }}
            />
            <label className="form-check-label" htmlFor="onlyInheritRelatedGroupsRadio">
              {t('modal_granted_groups_inheritance_select.only_inherit_related_groups')}
            </label>
          </div>
        </div>
      </ModalBody>
      <ModalFooter className="grw-modal-footer">
        <button type="button" className="me-2 btn btn-secondary" onClick={() => closeModal()}>{t('Cancel')}</button>
        <button className="btn btn-primary" type="button" onClick={onCreateBtnClick}>
          {t('modal_granted_groups_inheritance_select.create_page')}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export default GrantedGroupsInheritanceSelectModal;
