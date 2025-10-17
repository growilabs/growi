import React, { useCallback, type JSX } from 'react';

import type { IAdminExternalAccount } from '@growi/core';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import AdminExternalAccountsContainer from '~/client/services/AdminExternalAccountsContainer';
import { toastSuccess, toastError } from '~/client/util/toastr';
import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';

import { withUnstatedContainers } from '../../UnstatedUtils';

import styles from './ExternalAccountTable.module.scss';

type ExternalAccountTableProps = {
  adminExternalAccountsContainer: AdminExternalAccountsContainer,
}

const ExternalAccountTable = (props: ExternalAccountTableProps): JSX.Element => {

  const { t } = useTranslation('admin');

  const { adminExternalAccountsContainer } = props;

  const removeExtenalAccount = useCallback(async(externalAccountId) => {
    try {
      const accountId = await adminExternalAccountsContainer.removeExternalAccountById(externalAccountId);
      toastSuccess(t('toaster.remove_external_user_success', { accountId }));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminExternalAccountsContainer, t]);

  return (
    <div className="table-responsive text-nowrap">
      <table className={`${styles['ea-table']} table table-bordered table-user-list`}>
        <thead>
          <tr>
            <th style={{ width: '100px' }}>
              <div className="d-flex align-items-center">
                {t('user_management.authentication_provider')}
              </div>
            </th>
            <th style={{ width: '200px' }}>
              <div className="d-flex align-items-center">
                <code>accountId</code>
              </div>
            </th>
            <th style={{ width: '200px' }}>
              <div className="d-flex align-items-center">
                {t('user_management.related_username')}<code className="ms-2">username</code>
              </div>
            </th>
            <th style={{ width: '100px' }}>
              <div className="d-flex align-items-center">
                {t('user_management.password_setting')}
                <span
                  role="button"
                  className="text-muted mx-2"
                  data-bs-toggle="popper"
                  data-placement="top"
                  data-trigger="hover"
                  data-html="true"
                  title={t('user_management.password_setting_help')}
                >
                  <small><span className="material-symbols-outlined" aria-hidden="true">help</span></small>
                </span>
              </div>
            </th>
            <th style={{ width: '100px' }}>
              <div className="d-flex align-items-center">
                {t('Created')}
              </div>
            </th>
            <th style={{ width: '70px' }}></th>
          </tr>
        </thead>
        <tbody>
          { adminExternalAccountsContainer.state.externalAccounts.map((ea: IAdminExternalAccount<IExternalAuthProviderType>) => {
            return (
              <tr key={ea._id}>
                <td><span>{ea.providerType}</span></td>
                <td><strong>{ea.accountId}</strong></td>
                <td><strong>{ea.user.username}</strong></td>
                <td>
                  {ea.user.password
                    ? (<span className="badge bg-info">{t('user_management.set')}</span>)
                    : (<span className="badge bg-warning text-dark">{t('user_management.unset')}</span>)
                  }
                </td>
                <td>{dateFnsFormat(ea.createdAt, 'yyyy-MM-dd')}</td>
                <td>
                  <div className="btn-group admin-user-menu">
                    <button type="button" className="btn btn-outline-secondary btn-sm dropdown-toggle" data-bs-toggle="dropdown">
                      <span className="material-symbols-outlined">settings</span> <span className="caret"></span>
                    </button>
                    <ul className="dropdown-menu" role="menu">
                      <li className="dropdown-header">{t('user_management.user_table.edit_menu')}</li>
                      <button
                        className="dropdown-item"
                        type="button"
                        role="button"
                        onClick={() => removeExtenalAccount(ea._id)}
                      >
                        <span className="material-symbols-outlined text-danger">delete_forever</span> {t('Delete')}
                      </button>
                    </ul>
                  </div>
                </td>
              </tr>
            );
          }) }
        </tbody>
      </table>
    </div>

  );
};

const ExternalAccountTableWrapper = withUnstatedContainers(ExternalAccountTable, [AdminExternalAccountsContainer]);

export default ExternalAccountTableWrapper;
