import React, { type JSX, useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { useCurrentPagePath, useRedirectFrom } from '~/states/page';

export const PageRedirectedAlert = React.memo((): JSX.Element => {
  const { t } = useTranslation();
  const currentPagePath = useCurrentPagePath();
  const redirectFrom = useRedirectFrom();

  const [isUnlinked, setIsUnlinked] = useState(false);

  const unlinkButtonClickHandler = useCallback(async () => {
    if (currentPagePath == null) {
      return;
    }
    try {
      const unlink = (await import('~/client/services/page-operation')).unlink;
      await unlink(currentPagePath);
      setIsUnlinked(true);
    } catch (err) {
      const toastError = (await import('~/client/util/toastr')).toastError;
      toastError(err);
    }
  }, [currentPagePath]);

  if (redirectFrom == null || redirectFrom === '') {
    return <></>;
  }

  if (isUnlinked) {
    return (
      <div className="alert alert-info d-edit-none py-3 px-4">
        <strong>{t('Unlinked')}: </strong> {t('page_page.notice.unlinked')}
      </div>
    );
  }

  return (
    <div className="alert alert-pink d-edit-none py-3 px-4 d-flex align-items-center justify-content-between">
      <span>
        <strong>{t('Redirected')}:</strong> {t('page_page.notice.redirected')}{' '}
        <code>{redirectFrom}</code> {t('page_page.notice.redirected_period')}
      </span>
      <button
        type="button"
        id="unlink-page-button"
        onClick={unlinkButtonClickHandler}
        className="btn btn-outline-dark btn-sm float-end"
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          link_off
        </span>
        {t('unlink_redirection')}
      </button>
    </div>
  );
});
PageRedirectedAlert.displayName = 'PageRedirectedAlert';
