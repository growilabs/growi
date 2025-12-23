import { useState, useCallback } from 'react';

import { useTranslation } from 'react-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import {
  useGrantedGroupsInheritanceSelectModalActions, useGrantedGroupsInheritanceSelectModalStatus,
} from '~/states/ui/modal/granted-groups-inheritance-select';

/**
 * GrantedGroupsInheritanceSelectModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
type GrantedGroupsInheritanceSelectModalSubstanceProps = {
  onCreateBtnClick: ((onlyInheritUserRelatedGrantedGroups: boolean) => Promise<void>) | undefined;
  closeModal: () => void;
};

const GrantedGroupsInheritanceSelectModalSubstance = (props: GrantedGroupsInheritanceSelectModalSubstanceProps): React.JSX.Element => {
  const { onCreateBtnClick: _onCreateBtnClick, closeModal } = props;
  const { t } = useTranslation();

  const [onlyInheritUserRelatedGrantedGroups, setOnlyInheritUserRelatedGrantedGroups] = useState(false);

  const onCreateBtnClick = useCallback(async() => {
    await _onCreateBtnClick?.(onlyInheritUserRelatedGrantedGroups);
    setOnlyInheritUserRelatedGrantedGroups(false); // reset to false after create request
  }, [_onCreateBtnClick, onlyInheritUserRelatedGrantedGroups]);

  const setInheritAll = useCallback(() => setOnlyInheritUserRelatedGrantedGroups(false), []);
  const setInheritRelatedOnly = useCallback(() => setOnlyInheritUserRelatedGrantedGroups(true), []);

  return (
    <>
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
              onChange={setInheritAll}
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
              onChange={setInheritRelatedOnly}
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
    </>
  );
};

/**
 * GrantedGroupsInheritanceSelectModal - Container component (lightweight, always rendered)
 */
export const GrantedGroupsInheritanceSelectModal = (): React.JSX.Element => {
  const { isOpened, onCreateBtnClick } = useGrantedGroupsInheritanceSelectModalStatus();
  const { close: closeModal } = useGrantedGroupsInheritanceSelectModalActions();

  return (
    <Modal
      isOpen={isOpened}
      toggle={() => closeModal()}
    >
      {isOpened && (
        <GrantedGroupsInheritanceSelectModalSubstance
          onCreateBtnClick={onCreateBtnClick}
          closeModal={closeModal}
        />
      )}
    </Modal>
  );
};
