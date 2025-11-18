import type { JSX } from 'react';
import dynamic from 'next/dynamic';
import type { IPage, IPagePopulatedToShowRevision } from '@growi/core';

import styles from './PageContentFooter.module.scss';

const AuthorInfo = dynamic(
  () => import('~/client/components/AuthorInfo').then((mod) => mod.AuthorInfo),
  { ssr: false },
);

export type PageContentFooterProps = {
  page: IPage | IPagePopulatedToShowRevision;
};

export const PageContentFooter = (
  props: PageContentFooterProps,
): JSX.Element => {
  const { page } = props;

  const { creator, lastUpdateUser, createdAt, updatedAt } = page;

  if (page.isEmpty) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <div className={`${styles['page-content-footer']} my-4 pt-4 d-edit-none`}>
      <div className="page-meta">
        <AuthorInfo
          user={creator}
          date={createdAt}
          mode="create"
          locate="footer"
        />
        <AuthorInfo
          user={lastUpdateUser}
          date={updatedAt}
          mode="update"
          locate="footer"
        />
      </div>
    </div>
  );
};
