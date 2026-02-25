import React, { type JSX, useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { useCurrentPagePath, useRedirectFrom } from '~/states/page';

type SubstanceProps = {
  redirectFrom: string;
};

const PageRedirectedAlertSubstance = React.memo(
  (props: SubstanceProps): JSX.Element => {
    const { t } = useTranslation();
    const { redirectFrom } = props;
    const currentPagePath = useCurrentPagePath();

    const [isUnlinked, setIsUnlinked] = useState(false);

    const unlinkButtonClickHandler = useCallback(async () => {
      if (currentPagePath == null) {
        return;
      }
      try {
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        const unlink = (await import('~/client/services/page-operation'))
          .unlink;
        await unlink(currentPagePath);
        setIsUnlinked(true);
      } catch (err) {
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        const toastError = (await import('~/client/util/toastr')).toastError;
        toastError(err);
      }
    }, [currentPagePath]);

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
  },
);
PageRedirectedAlertSubstance.displayName = 'PageRedirectedAlertSubstance';

export const PageRedirectedAlert = React.memo((): JSX.Element => {
  const redirectFrom = useRedirectFrom();

  // Lightweight condition check in Container
  if (redirectFrom == null || redirectFrom === '') {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  // Render Substance only when redirectFrom exists
  // Dynamic imports will only be executed when the unlink button is clicked
  return <PageRedirectedAlertSubstance redirectFrom={redirectFrom} />;
});
PageRedirectedAlert.displayName = 'PageRedirectedAlert';
