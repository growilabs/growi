import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { useCurrentPageData } from '~/states/page';
import { usePageControlsX } from '~/states/ui/page';

import { PagePathHeader } from './PagePathHeader';
import { PageTitleHeader } from './PageTitleHeader';

import styles from './PageHeader.module.scss';

const moduleClass = styles['page-header'] ?? '';

export const PageHeader = (): JSX.Element => {
  const currentPage = useCurrentPageData();
  const pageControlsX = usePageControlsX();
  const pageHeaderRef = useRef<HTMLDivElement>(null);

  const [maxWidth, setMaxWidth] = useState<number>(300);

  const calcMaxWidth = useCallback(() => {
    if (pageHeaderRef.current == null) {
      return;
    }

    // For mobile screens (< 576px), use full screen width
    if (window.innerWidth < 576) {
      const maxWidth = window.innerWidth - pageHeaderRef.current.getBoundingClientRect().x;
      setMaxWidth(maxWidth);
      return;
    }

    if (pageControlsX == null) {
      return;
    }

    // PageControls.x - PageHeader.x
    const maxWidth =
      pageControlsX - pageHeaderRef.current.getBoundingClientRect().x;

    setMaxWidth(maxWidth);
  }, [pageControlsX]);

  useEffect(() => {
    calcMaxWidth();

    // Recalculate on window resize
    window.addEventListener('resize', calcMaxWidth);
    return () => {
      window.removeEventListener('resize', calcMaxWidth);
    };
  }, [calcMaxWidth]);

  if (currentPage == null) {
    return <></>;
  }

  return (
    <div className={`${moduleClass} w-100`} ref={pageHeaderRef}>
      <PagePathHeader
        currentPage={currentPage}
        maxWidth={maxWidth}
        onRenameTerminated={calcMaxWidth}
      />
      <div className="mt-0 mt-md-1">
        <PageTitleHeader
          currentPage={currentPage}
          maxWidth={maxWidth}
          onMoveTerminated={calcMaxWidth}
        />
      </div>
    </div>
  );
};
