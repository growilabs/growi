import React, { type JSX } from 'react';

import type { IPageHasId } from '@growi/core';
import { UserPicture, PageListMeta, PagePathLabel } from '@growi/ui/dist/components';
import Link from 'next/link';
import Clamp from 'react-multiline-clamp';

import styles from './PageListItemS.module.scss';

type PageListItemSProps = {
  page: IPageHasId,
  noLink?: boolean,
  pageTitle?: string
  isNarrowView?: boolean,
}

export const PageListItemS = (props: PageListItemSProps): JSX.Element => {

  const {
    page,
    noLink = false,
    pageTitle,
    isNarrowView = false,
  } = props;

  const path = pageTitle != null ? pageTitle : page.path;

  let pagePathElement = <PagePathLabel path={path} additionalClassNames={['mx-1']} />;
  if (!noLink) {
    pagePathElement = <Link href={`/${page._id}`} className="text-break" prefetch={false}>{pagePathElement}</Link>;
  }

  return (
    <>
      <UserPicture user={page.lastUpdateUser} noLink={noLink} />
      {isNarrowView ? (
        <Clamp lines={2}>
          <div className={`mx-1 ${styles['page-title']} ${noLink ? 'text-break' : ''}`}>
            {pagePathElement}
          </div>
        </Clamp>
      ) : (
        pagePathElement
      )}
      <span className="ms-1">
        <PageListMeta page={page} shouldSpaceOutIcon />
      </span>
    </>
  );

};
