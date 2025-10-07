import Link from 'next/link';
import React, { type JSX, memo, useCallback } from 'react';
import urljoin from 'url-join';

import type LinkedPagePath from '~/models/linked-page-path';

import styles from './PagePathHierarchicalLink.module.scss';

type PagePathHierarchicalLinkProps = {
  linkedPagePath: LinkedPagePath;
  linkedPagePathByHtml?: LinkedPagePath;
  basePath?: string;
  isInTrash?: boolean;
  isIconHidden?: boolean;

  // !!INTERNAL USE ONLY!!
  isInnerElem?: boolean;
};

export const PagePathHierarchicalLink = memo(
  (props: PagePathHierarchicalLinkProps): JSX.Element => {
    const {
      linkedPagePath,
      linkedPagePathByHtml,
      basePath,
      isInTrash,
      isInnerElem,
    } = props;

    const isIconHidden = props.isIconHidden ?? false;

    // eslint-disable-next-line react/prop-types
    const RootElm = useCallback(
      ({ children }) => {
        return isInnerElem ? (
          <>{children}</>
        ) : (
          <span className="text-break" id="grw-page-path-hierarchical-link">
            {children}
          </span>
        );
      },
      [isInnerElem],
    );

    // render root element
    if (linkedPagePath.isRoot) {
      if (basePath != null || isIconHidden) {
        return <></>;
      }

      return isInTrash ? (
        <RootElm>
          <span className="path-segment">
            <Link href="/trash" prefetch={false}>
              <span
                className={`material-symbols-outlined ${styles['material-symbols-outlined']}`}
              >
                delete
              </span>
            </Link>
          </span>
          <span className={`separator ${styles.separator}`}>
            <a href="/">/</a>
          </span>
        </RootElm>
      ) : (
        <RootElm>
          <span className="path-segment">
            <Link href="/" prefetch={false}>
              <span
                className={`material-symbols-outlined ${styles['material-symbols-outlined']}`}
              >
                home
              </span>
              <span className={`separator ${styles.separator}`}>/</span>
            </Link>
          </span>
        </RootElm>
      );
    }

    const isParentExists = linkedPagePath.parent != null;
    const isParentRoot = linkedPagePath.parent?.isRoot;
    const isSeparatorRequired = isParentExists && !isParentRoot;

    const shouldDangerouslySetInnerHTML = linkedPagePathByHtml != null;

    const href = encodeURI(urljoin(basePath || '/', linkedPagePath.href));

    return (
      <RootElm>
        {isParentExists && (
          <PagePathHierarchicalLink
            linkedPagePath={linkedPagePath.parent}
            linkedPagePathByHtml={linkedPagePathByHtml?.parent}
            basePath={basePath}
            isInTrash={isInTrash || linkedPagePath.isInTrash}
            isInnerElem
            isIconHidden={isIconHidden}
          />
        )}
        {isSeparatorRequired && (
          <span className={`separator ${styles.separator}`}>/</span>
        )}

        <Link href={href} prefetch={false} legacyBehavior>
          {shouldDangerouslySetInnerHTML ? (
            // eslint-disable-next-line react/no-danger
            <a
              className="page-segment"
              dangerouslySetInnerHTML={{
                __html: linkedPagePathByHtml.pathName,
              }}
            ></a>
          ) : (
            <a className="page-segment">{linkedPagePath.pathName}</a>
          )}
        </Link>
      </RootElm>
    );
  },
);
