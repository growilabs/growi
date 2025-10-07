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

const AssociateModal = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const { mutate: mutatePersonalExternalAccounts } = useSWRxPersonalExternalAccounts();
  const { trigger: associateLdapAccount, isMutating } = useAssociateLdapAccount();
  const [activeTab, setActiveTab] = useState(1);
  const { isOpen, onClose } = props;

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


  return (
    <Modal isOpen={isOpen} toggle={closeModalHandler} size="lg" data-testid="grw-associate-modal">
      <ModalHeader toggle={onClose}>
        { t('admin:user_management.create_external_account') }
      </ModalHeader>
      <ModalBody>
        <div>
          <Nav tabs className="mb-2">
            <NavLink
              className={`${activeTab === 1 ? 'active' : ''} d-flex gap-1 align-items-center`}
              onClick={() => setActiveTab(1)}
            >
              <span className="material-symbols-outlined fs-5">network_node</span> LDAP
            </NavLink>
            <NavLink
              className={`${activeTab === 2 ? 'active' : ''} d-flex gap-1 align-items-center`}
              onClick={() => setActiveTab(2)}
            >
              <span className="growi-custom-icons">github</span> (TBD) GitHub
            </NavLink>
            <NavLink
              className={`${activeTab === 3 ? 'active' : ''} d-flex gap-1 align-items-center`}
              onClick={() => setActiveTab(3)}
            >
              <span className="growi-custom-icons">google</span> (TBD) Google OAuth
            </NavLink>
          </Nav>
          <TabContent activeTab={activeTab}>
            <TabPane tabId={1}>
              <LdapAuthTest
                username={username}
                password={password}
                onChangeUsername={username => setUsername(username)}
                onChangePassword={password => setPassword(password)}
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
    </Modal>
  );
};


export default AssociateModal;
