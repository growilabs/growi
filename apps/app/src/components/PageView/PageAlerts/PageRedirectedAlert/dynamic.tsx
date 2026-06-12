import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useRedirectFrom } from '~/states/page';

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
