import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { useCurrentPageData } from '~/states/page/index.js';
import { useDeviceLargerThanSm } from '~/states/ui/device.js';
import { usePageControlsX } from '~/states/ui/page.js';

import { PagePathHeader } from './PagePathHeader.js';
import { PageTitleHeader } from './PageTitleHeader.js';

import styles from './PageHeader.module.scss';

const moduleClass = styles['page-header'] ?? '';

export const PageHeader = (): JSX.Element => {
  const currentPage = useCurrentPageData();
  const pageControlsX = usePageControlsX();
  const [isLargerThanSm] = useDeviceLargerThanSm();
  const pageHeaderRef = useRef<HTMLDivElement>(null);

  const [maxWidth, setMaxWidth] = useState<number>(300);

  const calcMaxWidth = useCallback(() => {
    if (pageHeaderRef.current == null) {
      return;
    }

    const pageHeaderX = pageHeaderRef.current.getBoundingClientRect().x;
    setMaxWidth(
      !isLargerThanSm
        ? window.innerWidth - pageHeaderX
        : pageControlsX != null
          ? pageControlsX - pageHeaderX
          : // Length that allows users to use PageHeader functionality.
            300,
    );
  }, [isLargerThanSm, pageControlsX]);

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
