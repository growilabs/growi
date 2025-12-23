import React, {
  useCallback, useEffect, memo, type JSX,
} from 'react';

import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';

import { useUnsavedWarning } from '~/states/ui/unsaved-warning';

const UnsavedAlertDialog = (): JSX.Element => {
  const { t } = useTranslation();
  const router = useRouter();
  const { isEnabled: isEnabledUnsavedWarning, reset } = useUnsavedWarning();

  const alertUnsavedWarningByBrowser = useCallback((e) => {
    if (isEnabledUnsavedWarning) {
      e.preventDefault();
      // returnValue should be set to show alert dialog
      // default alert message cannot be changed.
      // See -> https://developer.mozilla.org/ja/docs/Web/API/Window/beforeunload_event
      e.returnValue = '';
      return;
    }
  }, [isEnabledUnsavedWarning]);

  const alertUnsavedWarningByNextRouter = useCallback(() => {
    if (isEnabledUnsavedWarning) {
      // see: https://zenn.dev/qaynam/articles/c4794537a163d2
      // eslint-disable-next-line no-alert
      const answer = window.confirm(t('page_edit.changes_not_saved'));
      if (!answer) {
        // eslint-disable-next-line no-throw-literal
        throw 'Abort route';
      }
    }
  }, [isEnabledUnsavedWarning, t]);

  const onRouterChangeComplete = useCallback(() => {
    reset();
  }, [reset]);

  /*
  * Route changes by Browser
  * Example: window.location.href, F5
  */
  useEffect(() => {
    window.addEventListener('beforeunload', alertUnsavedWarningByBrowser);
    return () => {
      window.removeEventListener('beforeunload', alertUnsavedWarningByBrowser);
    };
  }, [alertUnsavedWarningByBrowser]);


  /*
  * Route changes by Next Router
  * https://nextjs.org/docs/api-reference/next/router
  */
  useEffect(() => {
    router.events.on('routeChangeStart', alertUnsavedWarningByNextRouter);
    return () => {
      router.events.off('routeChangeStart', alertUnsavedWarningByNextRouter);
    };
  }, [alertUnsavedWarningByNextRouter, router.events]);


  useEffect(() => {
    router.events.on('routeChangeComplete', onRouterChangeComplete);
    return () => {
      router.events.off('routeChangeComplete', onRouterChangeComplete);
    };
  }, [onRouterChangeComplete, router.events]);


  return <></>;
};

export default memo(UnsavedAlertDialog);
