import React, { useCallback, useEffect, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import Link from 'next/link';

import AdminExternalAccountsContainer from '~/client/services/AdminExternalAccountsContainer';
import { toastError } from '~/client/util/toastr';

import PaginationWrapper from '../PaginationWrapper';
import { withUnstatedContainers } from '../UnstatedUtils';

import ExternalAccountTable from './Users/ExternalAccountTable';

type ManageExternalAccountProps = {
  adminExternalAccountsContainer: AdminExternalAccountsContainer,
}

const ManageExternalAccount = (props: ManageExternalAccountProps): JSX.Element => {

  const { t } = useTranslation();
  const { adminExternalAccountsContainer } = props;
  const { activePage, totalAccounts, pagingLimit } = adminExternalAccountsContainer.state;

  const externalAccountPageHandler = useCallback(async(selectedPage) => {
    try {
      await adminExternalAccountsContainer.retrieveExternalAccountsByPagingNum(selectedPage);
    }
    catch (err) {
      toastError(err);
    }
  }, [adminExternalAccountsContainer]);

  // for Next routing
  useEffect(() => {
    externalAccountPageHandler(1);
  }, [externalAccountPageHandler]);

  const pager = (
    <PaginationWrapper
      activePage={activePage}
      changePage={externalAccountPageHandler}
      totalItemsCount={totalAccounts}
      pagingLimit={pagingLimit}
      align="center"
      size="sm"
    />
  );

  return (
    <>
      <p>
        <Link
          href="/admin/users"
          prefetch={false}
          className="btn btn-outline-secondary"
        >
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {t('admin:user_management.back_to_user_management')}
        </Link>
      </p>
      <h2>{t('admin:user_management.external_account_list')}</h2>
      {(totalAccounts !== 0) ? (
        <>
          {pager}
          <ExternalAccountTable />
          {pager}
        </>
      )
        : (
          <>
            { t('admin:user_management.external_account_none') }
          </>
        )
      }
    </>
  );
};

const ManageExternalAccountWrapper = withUnstatedContainers(ManageExternalAccount, [AdminExternalAccountsContainer]);

export default ManageExternalAccountWrapper;
