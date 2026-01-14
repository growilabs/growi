import { type JSX, useMemo } from 'react';
import { DevidedPagePath } from '@growi/core/dist/models';
import { pagePathUtils } from '@growi/core/dist/utils';

import LinkedPagePath from '~/models/linked-page-path';

import { PagePathHierarchicalLink } from '../PagePathHierarchicalLink';
import { Separator } from '.';
import type { PagePathNavLayoutProps } from './PagePathNavLayout';
import { PagePathNavLayout } from './PagePathNavLayout';

const { isTrashPage } = pagePathUtils;

export const PagePathNav = (props: PagePathNavLayoutProps): JSX.Element => {
  const { pagePath } = props;

  const isInTrash = isTrashPage(pagePath);

  const formerLink = useMemo(() => {
    const dPagePath = new DevidedPagePath(pagePath, false, true);

    // one line
    if (dPagePath.isRoot || dPagePath.isFormerRoot) {
      return undefined;
    }

    // two line
    const linkedPagePathFormer = new LinkedPagePath(dPagePath.former);
    return (
      <>
        <PagePathHierarchicalLink
          linkedPagePath={linkedPagePathFormer}
          isInTrash={isInTrash}
        />
        <Separator />
      </>
    );
  }, [isInTrash, pagePath]);

  const latterLink = useMemo(() => {
    const dPagePath = new DevidedPagePath(pagePath, false, true);

    // one line
    if (dPagePath.isRoot || dPagePath.isFormerRoot) {
      const linkedPagePath = new LinkedPagePath(pagePath);
      return (
        <PagePathHierarchicalLink
          linkedPagePath={linkedPagePath}
          isInTrash={isInTrash}
        />
      );
    }

    // two line
    const linkedPagePathLatter = new LinkedPagePath(dPagePath.latter);
    return (
      <PagePathHierarchicalLink
        linkedPagePath={linkedPagePathLatter}
        basePath={dPagePath.former}
        isInTrash={isInTrash}
      />
    );
  }, [isInTrash, pagePath]);

  return (
    <PagePathNavLayout
      {...props}
      formerLink={formerLink}
      latterLink={latterLink}
    />
  );
};
