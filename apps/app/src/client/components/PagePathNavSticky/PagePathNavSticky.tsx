import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { DevidedPagePath } from '@growi/core/dist/models';
import { pagePathUtils } from '@growi/core/dist/utils';
import Sticky from 'react-stickynode';

import { usePrintMode } from '~/client/services/use-print-mode';
import LinkedPagePath from '~/models/linked-page-path';
import { usePageControlsX } from '~/states/ui/page';
import { useCurrentProductNavWidth, useSidebarMode } from '~/states/ui/sidebar';

import { PagePathHierarchicalLink } from '../../../components/Common/PagePathHierarchicalLink';
import type { PagePathNavLayoutProps } from '../../../components/Common/PagePathNav';
import {
  PagePathNav,
  PagePathNavLayout,
  Separator,
} from '../../../components/Common/PagePathNav';
import { CollapsedParentsDropdown } from './CollapsedParentsDropdown';

import styles from './PagePathNavSticky.module.scss';

const moduleClass = styles['grw-page-path-nav-sticky'];

const { isTrashPage } = pagePathUtils;

export const PagePathNavSticky = (
  props: PagePathNavLayoutProps,
): JSX.Element => {
  const { pagePath, latterLinkClassName, ...rest } = props;

  const isPrinting = usePrintMode();

  const pageControlsX = usePageControlsX();
  const [sidebarWidth] = useCurrentProductNavWidth();
  const { sidebarMode } = useSidebarMode();
  const pagePathNavRef = useRef<HTMLDivElement>(null);

  const [navMaxWidth, setNavMaxWidth] = useState<number | undefined>();

  useEffect(() => {
    if (
      pageControlsX == null ||
      pagePathNavRef.current == null ||
      sidebarWidth == null
    ) {
      return;
    }
    setNavMaxWidth(
      pageControlsX - pagePathNavRef.current.getBoundingClientRect().x - 10,
    );
  }, [pageControlsX, sidebarWidth]);

  useEffect(() => {
    // wait for the end of the animation of the opening and closing of the sidebar
    const timeout = setTimeout(() => {
      if (
        pageControlsX == null ||
        pagePathNavRef.current == null ||
        sidebarMode == null
      ) {
        return;
      }
      setNavMaxWidth(
        pageControlsX - pagePathNavRef.current.getBoundingClientRect().x - 10,
      );
    }, 200);
    return () => {
      clearTimeout(timeout);
    };
  }, [pageControlsX, sidebarMode]);

  const latterLink = useMemo(() => {
    const dPagePath = new DevidedPagePath(pagePath, false, true);

    const isInTrash = isTrashPage(pagePath);

    const linkedPagePathFormer = new LinkedPagePath(dPagePath.former);
    const linkedPagePathLatter = new LinkedPagePath(dPagePath.latter);

    // not collapsed
    if (dPagePath.isRoot || dPagePath.isFormerRoot) {
      const linkedPagePath = new LinkedPagePath(pagePath);
      return (
        <PagePathHierarchicalLink
          linkedPagePath={linkedPagePath}
          isInTrash={isInTrash}
        />
      );
    }

    // collapsed
    return (
      <>
        <CollapsedParentsDropdown linkedPagePath={linkedPagePathFormer} />
        <Separator />
        <PagePathHierarchicalLink
          linkedPagePath={linkedPagePathLatter}
          basePath={dPagePath.former}
          isInTrash={isInTrash}
        />
      </>
    );
  }, [pagePath]);

  return (
    // Controlling pointer-events
    //  1. disable pointer-events with 'pe-none'
    <div ref={pagePathNavRef}>
      <Sticky
        className={moduleClass}
        enabled={!isPrinting}
        innerClass="z-2 pe-none"
        innerActiveClass="active z-3 mt-1"
      >
        {({ status }) => {
          const isStatusFixed = status === Sticky.STATUS_FIXED;

          return (
            <>
              {/*
               * Controlling pointer-events
               * 2. enable pointer-events with 'pe-auto' only against the children
               *      which width is minimized by 'd-inline-block'
               */}
              {isStatusFixed && (
                <div className="d-inline-block pe-auto position-absolute">
                  <PagePathNavLayout
                    pagePath={pagePath}
                    latterLink={latterLink}
                    latterLinkClassName={`${latterLinkClassName} text-truncate`}
                    maxWidth={navMaxWidth}
                    {...rest}
                  />
                </div>
              )}

              {/*
               * Use 'd-block' to make the children take the full width
               * This is to improve UX when opening/closing CopyDropdown
               */}
              <div
                className={`d-block pe-auto ${isStatusFixed ? 'invisible' : ''}`}
              >
                <PagePathNav
                  pagePath={pagePath}
                  latterLinkClassName={latterLinkClassName}
                  inline
                  {...rest}
                />
              </div>
            </>
          );
        }}
      </Sticky>
    </div>
  );
};

PagePathNavSticky.displayName = 'PagePathNavSticky';
