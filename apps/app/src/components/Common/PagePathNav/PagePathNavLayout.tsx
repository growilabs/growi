import type { JSX, ReactNode } from 'react';
import dynamic from 'next/dynamic';

import { usePageNotFound } from '~/states/page';

import styles from './PagePathNavLayout.module.scss';

const moduleClass = styles['grw-page-path-nav-layout'] ?? '';

export type PagePathNavLayoutProps = {
  pagePath: string;
  inline?: boolean;
  className?: string;
  pageId?: string | null;
  isWipPage?: boolean;
  maxWidth?: number;
  formerLinkClassName?: string;
  latterLinkClassName?: string;
};

type Props = PagePathNavLayoutProps & {
  formerLink?: ReactNode;
  latterLink?: ReactNode;
};

const CopyDropdown = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Common/CopyDropdown').then(
      (mod) => mod.CopyDropdown,
    ),
  { ssr: false },
);

export const PagePathNavLayout = (props: Props): JSX.Element => {
  const {
    className = '',
    inline = false,
    pageId,
    pagePath,
    isWipPage,
    formerLink,
    formerLinkClassName = '',
    latterLink,
    latterLinkClassName = '',
    maxWidth,
  } = props;

  const isNotFound = usePageNotFound();

  const copyDropdownId = `copydropdown-in-pagepathnavlayout-${pageId}`;

  const containerLayoutClass = inline ? '' : 'd-flex align-items-center';

  return (
    <div className={`${className} ${moduleClass}`} style={{ maxWidth }}>
      {formerLink && (
        <span
          className={`${formerLinkClassName ?? ''} ${styles['grw-former-link']} mb-2 d-block`}
        >
          {formerLink}
        </span>
      )}
      <div className={containerLayoutClass}>
        <h1 className={`m-0 d-inline align-bottom ${latterLinkClassName}`}>
          {latterLink}
        </h1>
        {pageId != null && !isNotFound && (
          <span className="d-inline-flex align-items-center align-bottom ms-2 gap-2">
            {isWipPage && <span className="badge text-bg-secondary">WIP</span>}
            <span className="grw-page-path-nav-copydropdown">
              <CopyDropdown
                pageId={pageId}
                pagePath={pagePath}
                dropdownToggleId={copyDropdownId}
                dropdownToggleClassName="p-2"
                dropdownMenuContainer="body"
              >
                <span className="material-symbols-outlined">content_paste</span>
              </CopyDropdown>
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
