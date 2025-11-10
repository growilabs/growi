import React, { useCallback } from 'react';

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

/**
 * DisassociateModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
type DisassociateModalSubstanceProps = {
  onClose: () => void;
  accountForDisassociate: IExternalAccount<IExternalAuthProviderType> & HasObjectId;
};

const DisassociateModalSubstance = (props: DisassociateModalSubstanceProps): React.JSX.Element => {
  const { onClose, accountForDisassociate } = props;
  const { t } = useTranslation();
  const { mutate: mutatePersonalExternalAccounts } = useSWRxPersonalExternalAccounts();
  const { trigger: disassociateLdapAccount } = useDisassociateLdapAccount();

  const { providerType, accountId } = accountForDisassociate;

  const disassociateAccountHandler = useCallback(async() => {
    try {
      await disassociateLdapAccount({ providerType, accountId });
      onClose();
      toastSuccess(t('security_settings.updated_general_security_setting'));
    }
    catch (err) {
      toastError(err);
    }

    if (mutatePersonalExternalAccounts != null) {
      mutatePersonalExternalAccounts();
    }
  }, [accountId, disassociateLdapAccount, mutatePersonalExternalAccounts, onClose, providerType, t]);

  return (
    <>
      <ModalHeader className="text-info" toggle={onClose}>
        {t('personal_settings.disassociate_external_account')}
      </ModalHeader>
      <ModalBody>
        {/* eslint-disable-next-line react/no-danger */}
        <p dangerouslySetInnerHTML={{ __html: t('personal_settings.disassociate_external_account_desc', { providerType, accountId }) }} />
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
          { t('Cancel') }
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={disassociateAccountHandler}>
          <span className="material-symbols-outlined">link_off</span>
          { t('Disassociate') }
        </button>
      </ModalFooter>
    </>
  );
};

/**
 * DisassociateModal - Container component (lightweight, always rendered)
 */
const DisassociateModal = (props: Props): React.JSX.Element => {
  const { isOpen, onClose, accountForDisassociate } = props;

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      {isOpen && (
        <DisassociateModalSubstance
          onClose={onClose}
          accountForDisassociate={accountForDisassociate}
        />
      )}
    </Modal>
  );
};


export default DisassociateModal;
