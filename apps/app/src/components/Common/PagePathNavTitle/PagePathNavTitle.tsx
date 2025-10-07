import dynamic from 'next/dynamic';

import withLoadingProps from 'next-dynamic-loading-props';
import { type JSX, useState } from 'react';
import { useIsomorphicLayoutEffect } from 'usehooks-ts';
import type { PagePathNavLayoutProps } from '../PagePathNav';
import { PagePathNav } from '../PagePathNav';

import styles from './PagePathNavTitle.module.scss';

const moduleClass = styles['grw-page-path-nav-title'] ?? '';

const PagePathNavSticky = withLoadingProps<PagePathNavLayoutProps>(
  (useLoadingProps) =>
    dynamic(
      () =>
        import('~/client/components/PagePathNavSticky').then(
          (mod) => mod.PagePathNavSticky,
        ),
      {
        ssr: false,
        loading: () => {
          // eslint-disable-next-line react-hooks/rules-of-hooks
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
    <PagePathNavSticky
      {...props}
      className={moduleClass}
      latterLinkClassName="fs-2"
    />
  ) : (
    <PagePathNav
      {...props}
      className={moduleClass}
      latterLinkClassName="fs-2"
    />
  );
};
