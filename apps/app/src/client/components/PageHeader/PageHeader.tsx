import {
  useCallback, useEffect, useRef, useState, type JSX,
} from 'react';

import { useSWRxCurrentPage } from '~/stores/page';
import { usePageControlsX } from '~/stores/ui';

import { PagePathHeader } from './PagePathHeader';
import { PageTitleHeader } from './PageTitleHeader';

import styles from './PageHeader.module.scss';

const moduleClass = styles['page-header'] ?? '';

export const PageHeader = (): JSX.Element => {

  const { data: currentPage } = useSWRxCurrentPage();
  const { data: pageControlsX } = usePageControlsX();
  const pageHeaderRef = useRef<HTMLDivElement>(null);

  const [maxWidth, setMaxWidth] = useState<number>();

  const calcMaxWidth = useCallback(() => {
    if (pageControlsX == null || pageHeaderRef.current == null) {
      // Length that allows users to use PageHeader functionality.
      setMaxWidth(300);
      return;
    }

    // PageControls.x - PageHeader.x
    const maxWidth = pageControlsX - pageHeaderRef.current.getBoundingClientRect().x;

    setMaxWidth(maxWidth);
  }, [pageControlsX]);

  useEffect(() => {
    calcMaxWidth();
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
