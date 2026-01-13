import { type JSX, useState } from 'react';
import dynamic from 'next/dynamic';
import withLoadingProps from 'next-dynamic-loading-props';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';

import type { PagePathNavLayoutProps } from '../PagePathNav';
import { PagePathNav } from '../PagePathNav';

const PagePathNavSticky = withLoadingProps<PagePathNavLayoutProps>(
  (useLoadingProps) =>
    dynamic(
      () =>
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        import('~/client/components/PagePathNavSticky').then(
          (mod) => mod.PagePathNavSticky,
        ),
      {
        ssr: false,
        loading: () => {
          const props = useLoadingProps();
          return <PagePathNav {...props} />;
        },
      },
    ),
);

/**
 * Switch PagePathNav and PagePathNavSticky
 * @returns
 */
export const PagePathNavTitle = (
  props: PagePathNavLayoutProps,
): JSX.Element => {
  const [isClient, setClient] = useState(false);

  useIsomorphicLayoutEffect(() => {
    setClient(true);
  }, []);

  return isClient ? (
    <PagePathNavSticky {...props} latterLinkClassName="fs-2" />
  ) : (
    <PagePathNav {...props} latterLinkClassName="fs-2" />
  );
};
