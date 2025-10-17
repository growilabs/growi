import React, { type JSX, useMemo } from 'react';
import Link from 'next/link';
import { pathUtils } from '@growi/core/dist/utils';
import { PageListMeta, PagePathLabel } from '@growi/ui/dist/components';

import type { PageNode } from '../../../interfaces/page-node';
import type { LsxContext } from '../lsx-context';

import styles from './LsxPage.module.scss';

type Props = {
  pageNode: PageNode;
  lsxContext: LsxContext;
  depth: number;
  basisViewersCount?: number;
};

export const LsxPage = React.memo((props: Props): JSX.Element => {
  const { pageNode, lsxContext, depth, basisViewersCount } = props;

  const pageId = pageNode.page?._id;
  const pagePath = pageNode.pagePath;
  const isLinkable = (() => {
    // process depth option
    const optDepth = lsxContext.getOptDepth();
    if (optDepth == null) {
      return true;
    }

    // debug
    // console.log(pageNode.pagePath, {depth, decGens, 'optDepth.start': optDepth.start, 'optDepth.end': optDepth.end});

    return optDepth.start <= depth;
  })();
  const hasChildren = pageNode.children.length > 0;

  const childrenElements: JSX.Element = useMemo(() => {
    let element = <></>;

    // create child pages elements
    if (hasChildren) {
      const pages = pageNode.children.map((pageNode) => {
        return (
          <LsxPage
            key={pageNode.pagePath}
            depth={depth + 1}
            pageNode={pageNode}
            lsxContext={lsxContext}
            basisViewersCount={basisViewersCount}
          />
        );
      });

      element = <ul className="page-list-ul">{pages}</ul>;
    }

    return element;
  }, [basisViewersCount, depth, hasChildren, lsxContext, pageNode.children]);

  const iconElement: JSX.Element = useMemo(() => {
    const isExists = pageId != null;
    return isExists ? (
      <span className="material-symbols-outlined fs-5 me-1" aria-hidden="true">
        description
      </span>
    ) : (
      <span className="material-symbols-outlined fs-5 me-1" aria-hidden="true">
        draft
      </span>
    );
  }, [pageId]);

  const pagePathElement: JSX.Element = useMemo(() => {
    const isExists = pageId != null;

    const classNames: string[] = [];
    if (!isExists) {
      classNames.push('lsx-page-not-exist');
    }

    // create PagePath element
    let pagePathNode = (
      <PagePathLabel
        path={pagePath}
        isLatterOnly
        additionalClassNames={classNames}
      />
    );
    if (isLinkable) {
      const href = isExists
        ? `/${pageId}`
        : encodeURI(pathUtils.removeTrailingSlash(pagePath));

      pagePathNode = (
        <Link href={href} prefetch={false} className="page-list-link">
          {pagePathNode}
        </Link>
      );
    }
    return pagePathNode;
  }, [isLinkable, pageId, pagePath]);

  const pageListMetaElement: JSX.Element = useMemo(() => {
    if (pageNode.page == null) {
      return;
    }

    const { page } = pageNode;

    return (
      <PageListMeta
        page={page}
        basisViewersCount={basisViewersCount}
        likerCount={page.liker.length}
      />
    );
  }, [basisViewersCount, pageNode]);

  return (
    <li className={`page-list-li ${styles['page-list-li']} my-2`}>
      <div className="d-flex align-items-center">
        {iconElement} {pagePathElement}
        <span className="ms-2">{pageListMetaElement}</span>
      </div>
      {childrenElements}
    </li>
  );
});
LsxPage.displayName = 'LsxPage';
