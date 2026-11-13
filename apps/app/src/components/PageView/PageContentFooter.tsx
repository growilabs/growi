import type { JSX } from 'react';
import dynamic from 'next/dynamic';
import type { IPageHasId, IPagePopulatedToShowRevision } from '@growi/core';

// biome-ignore lint/style/noRestrictedImports: SSR-safe marks entry, rendered only inside the client-only AuthorInfo
import { CurrentRevisionProposalMark } from '~/features/change-proposal/client/viewer/marks';

import styles from './PageContentFooter.module.scss';

const AuthorInfo = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/AuthorInfo').then((mod) => mod.AuthorInfo),
  { ssr: false },
);

export type PageContentFooterProps = {
  page: IPageHasId | IPagePopulatedToShowRevision;
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
    <div className={`${styles['page-content-footer']} py-4 d-edit-none`}>
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
          proposalMark={<CurrentRevisionProposalMark pageId={page._id} />}
        />
      </div>
    </div>
  );
};
