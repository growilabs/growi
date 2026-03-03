import { type JSX, useRef } from 'react';

import { useCurrentPageData } from '~/states/page';
import { useDeviceLargerThanSm } from '~/states/ui/device';
import { usePageControlsX } from '~/states/ui/page';

import { PagePathHeader } from './PagePathHeader';
import { PageTitleHeader } from './PageTitleHeader';

import styles from './PageHeader.module.scss';

const moduleClass = styles['page-header'] ?? '';

export const PageHeader = (): JSX.Element => {
  const currentPage = useCurrentPageData();
  const pageControlsX = usePageControlsX();
  const [isLargerThanSm] = useDeviceLargerThanSm();
  const pageHeaderRef = useRef<HTMLDivElement>(null);

  if (currentPage == null) {
    return <></>;
  }

  const pageHeaderX = pageHeaderRef.current?.getBoundingClientRect().x ?? 0;
  const maxWidth = !isLargerThanSm
    ? window.innerWidth - pageHeaderX
    : pageControlsX != null
      ? pageControlsX - pageHeaderX
      : 300;

  return (
    <div className={`${moduleClass} w-100`} ref={pageHeaderRef}>
      <PagePathHeader currentPage={currentPage} maxWidth={maxWidth} />
      <div className="mt-0 mt-md-1">
        <PageTitleHeader currentPage={currentPage} maxWidth={maxWidth} />
      </div>
    </div>
  );
};
