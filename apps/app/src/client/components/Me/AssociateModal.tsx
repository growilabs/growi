import React, { useState, useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Nav,
  NavLink,
  TabContent,
  TabPane,
} from 'reactstrap';

import { toastSuccess, toastError } from '~/client/util/toastr';
import { useAssociateLdapAccount, useSWRxPersonalExternalAccounts } from '~/stores/personal-settings';

import { LdapAuthTest } from '../Admin/Security/LdapAuthTest';

type Props = {
  isOpen: boolean,
  onClose: () => void,
}

/**
 * AssociateModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
type AssociateModalSubstanceProps = {
  onClose: () => void;
};

const AssociateModalSubstance = (props: AssociateModalSubstanceProps): JSX.Element => {
  const { onClose } = props;
  const { t } = useTranslation();
  const { mutate: mutatePersonalExternalAccounts } = useSWRxPersonalExternalAccounts();
  const { trigger: associateLdapAccount } = useAssociateLdapAccount();

  const [activeTab, setActiveTab] = useState(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const closeModalHandler = useCallback(() => {
    onClose();
    setUsername('');
    setPassword('');
  }, [onClose]);

  const clickAddLdapAccountHandler = useCallback(async() => {
    try {
      await associateLdapAccount({ username, password });
      mutatePersonalExternalAccounts();

      closeModalHandler();
      toastSuccess(t('security_settings.updated_general_security_setting'));
    }
    catch (err) {
      toastError(err);
    }
  }, [associateLdapAccount, closeModalHandler, mutatePersonalExternalAccounts, password, t, username]);

  const setTabToLdap = useCallback(() => setActiveTab(1), []);
  const setTabToGithub = useCallback(() => setActiveTab(2), []);
  const setTabToGoogle = useCallback(() => setActiveTab(3), []);
  const handleUsernameChange = useCallback((username: string) => setUsername(username), []);
  const handlePasswordChange = useCallback((password: string) => setPassword(password), []);

  return (
    <>
      <ModalHeader toggle={onClose}>
        { t('admin:user_management.create_external_account') }
      </ModalHeader>
      <ModalBody>
        <div>
          <Nav tabs className="mb-2">
            <NavLink
              className={`${activeTab === 1 ? 'active' : ''} d-flex gap-1 align-items-center`}
              onClick={setTabToLdap}
            >
              <span className="material-symbols-outlined fs-5">network_node</span> LDAP
            </NavLink>
            <NavLink
              className={`${activeTab === 2 ? 'active' : ''} d-flex gap-1 align-items-center`}
              onClick={setTabToGithub}
            >
              <span className="growi-custom-icons">github</span> (TBD) GitHub
            </NavLink>
            <NavLink
              className={`${activeTab === 3 ? 'active' : ''} d-flex gap-1 align-items-center`}
              onClick={setTabToGoogle}
            >
              <span className="growi-custom-icons">google</span> (TBD) Google OAuth
            </NavLink>
          </Nav>
          <TabContent activeTab={activeTab}>
            <TabPane tabId={1}>
              <LdapAuthTest
                username={username}
                password={password}
                onChangeUsername={handleUsernameChange}
                onChangePassword={handlePasswordChange}
              />
            </TabPane>
            <TabPane tabId={2}>
              TBD
            </TabPane>
            <TabPane tabId={3}>
              TBD
            </TabPane>
            <TabPane tabId={4}>
              TBD
            </TabPane>
            <TabPane tabId={5}>
              TBD
            </TabPane>
          </TabContent>
        </div>
      </ModalBody>
      <ModalFooter className="border-top-0">
        <button type="button" className="btn btn-primary mt-3" data-testid="add-external-account-button" onClick={clickAddLdapAccountHandler}>
          <span className="material-symbols-outlined" aria-hidden="true">add_circle</span>
          {t('add')}
        </button>
      </ModalFooter>
    </>
  );
};

/**
 * AssociateModal - Container component (lightweight, always rendered)
 */
const AssociateModal = (props: Props): JSX.Element => {
  const { isOpen, onClose } = props;

  return (
    <Modal isOpen={isOpen} toggle={onClose} size="lg" data-testid="grw-associate-modal">
      {isOpen && <AssociateModalSubstance onClose={onClose} />}
    </Modal>
  );
};


export default AssociateModal;
