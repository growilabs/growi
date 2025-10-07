import React, { useCallback, type JSX } from 'react';

import type { HasObjectId, IExternalAccount } from '@growi/core';
import { useTranslation } from 'next-i18next';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from 'reactstrap';

import { toastSuccess, toastError } from '~/client/util/toastr';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { useDisassociateLdapAccount, useSWRxPersonalExternalAccounts } from '~/stores/personal-settings';

type Props = {
  isOpen: boolean,
  onClose: () => void,
  accountForDisassociate: IExternalAccount<IExternalAuthProviderType> & HasObjectId,
}


const DisassociateModal = (props: Props): JSX.Element => {

  const { t } = useTranslation();
  const { mutate: mutatePersonalExternalAccounts } = useSWRxPersonalExternalAccounts();
  const { trigger: disassociateLdapAccount } = useDisassociateLdapAccount();

  const { providerType, accountId } = props.accountForDisassociate;

  const disassociateAccountHandler = useCallback(async() => {

    try {
      await disassociateLdapAccount({ providerType, accountId });
      props.onClose();
      toastSuccess(t('security_settings.updated_general_security_setting'));
    }
    catch (err) {
      toastError(err);
    }

    if (mutatePersonalExternalAccounts != null) {
      mutatePersonalExternalAccounts();
    }
  }, [accountId, disassociateLdapAccount, mutatePersonalExternalAccounts, props, providerType, t]);

  return (
    <Modal isOpen={props.isOpen} toggle={props.onClose}>
      <ModalHeader className="text-info" toggle={props.onClose}>
        {t('personal_settings.disassociate_external_account')}
      </ModalHeader>
      <ModalBody>
        {/* eslint-disable-next-line react/no-danger */}
        <p dangerouslySetInnerHTML={{ __html: t('personal_settings.disassociate_external_account_desc', { providerType, accountId }) }} />
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={props.onClose}>
          { t('Cancel') }
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={disassociateAccountHandler}>
          <span className="material-symbols-outlined">link_off</span>
          { t('Disassociate') }
        </button>
      </ModalFooter>
    </Modal>
  );
};


export default DisassociateModal;
