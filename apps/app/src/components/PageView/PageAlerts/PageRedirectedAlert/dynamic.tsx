import type { JSX } from 'react';

import { useRedirectFrom } from '~/states/page';

import { useLazyLoader } from '../../../utils/use-lazy-loader';

export const PageRedirectedAlertLazyLoaded = (): JSX.Element => {
  const redirectFrom = useRedirectFrom();
  const isActive = redirectFrom != null && redirectFrom !== '';

  const PageRedirectedAlert = useLazyLoader<Record<string, unknown>>(
    'page-redirected-alert',
    () =>
      import('./PageRedirectedAlert').then((mod) => ({
        default: mod.PageRedirectedAlert,
      })),
    isActive,
  );

  return PageRedirectedAlert ? <PageRedirectedAlert /> : <></>;
};
