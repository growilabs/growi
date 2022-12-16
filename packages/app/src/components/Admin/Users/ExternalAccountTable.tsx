import React, { useCallback } from 'react';

import type { IAdminExternalAccount } from '@growi/core';
import dateFnsFormat from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import AdminExternalAccountsContainer from '~/client/services/AdminExternalAccountsContainer';
import { toastSuccess, toastError } from '~/client/util/apiNotification';

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
                {t('user_management.related_username')}<code className="ml-2">username</code>
              </div>
            </th>
            <th style={{ width: '100px' }}>
              <div className="d-flex align-items-center">
                {t('user_management.password_setting')}
                <span
                  role="button"
                  className="text-muted mx-2"
                  data-toggle="popper"
                  data-placement="top"
                  data-trigger="hover"
                  data-html="true"
                  title={t('user_management.password_setting_help')}
                >
                  <small><i className="icon-question" aria-hidden="true"></i></small>
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
          { adminExternalAccountsContainer.state.externalAccounts.map((ea: IAdminExternalAccount) => {
            return (
              <tr key={ea._id}>
                <td><span>{ea.providerType}</span></td>
                <td><strong>{ea.accountId}</strong></td>
                <td><strong>{ea.user.username}</strong></td>
                <td>
                  {ea.user.password
                    ? (<span className="badge badge-info">{t('user_management.set')}</span>)
                    : (<span className="badge badge-warning">{t('user_management.unset')}</span>)
                  }
                </td>
                <td>{dateFnsFormat(new Date(ea.createdAt), 'yyyy-MM-dd')}</td>
                <td>
                  <div className="btn-group admin-user-menu">
                    <button type="button" className="btn btn-outline-secondary btn-sm dropdown-toggle" data-toggle="dropdown">
                      <i className="icon-settings"></i> <span className="caret"></span>
                    </button>
                    <ul className="dropdown-menu" role="menu">
                      <li className="dropdown-header">{t('user_management.user_table.edit_menu')}</li>
                      <button
                        className="dropdown-item"
                        type="button"
                        role="button"
                        onClick={() => removeExtenalAccount(ea._id)}
                      >
                        <i className="icon-fw icon-fire text-danger"></i> {t('Delete')}
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
