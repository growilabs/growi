import React, { type JSX, useMemo } from 'react';

import type { PageNode } from '../../../interfaces/page-node';
import type { LsxContext } from '../lsx-context';
import { LsxPage } from './LsxPage';

import styles from './LsxListView.module.scss';

type Props = {
  nodeTree?: PageNode[];
  lsxContext: LsxContext;
  basisViewersCount?: number;
};

export const LsxListView = React.memo((props: Props): JSX.Element => {
  const { nodeTree, lsxContext, basisViewersCount } = props;

  const isEmpty = nodeTree == null || nodeTree.length === 0;

  const contents = useMemo(() => {
    if (isEmpty) {
      return (
        <div className="text-muted">
          <small>
            <span
              className="material-symbols-outlined fs-5 me-1"
              aria-hidden="true"
            >
              info
            </span>
            $lsx(<a href={lsxContext.pagePath}>{lsxContext.pagePath}</a>) has no
            contents
          </small>
        </div>
      );
    }

    return nodeTree.map((pageNode) => {
      return (
        <LsxPage
          key={pageNode.pagePath}
          depth={1}
          pageNode={pageNode}
          lsxContext={lsxContext}
          basisViewersCount={basisViewersCount}
        />
      );
    });
  }, [basisViewersCount, isEmpty, lsxContext, nodeTree]);

  return (
    <div className={`page-list ${styles['page-list']}`}>
      <ul className="page-list-ul">{contents}</ul>
    </div>
  );
});
LsxListView.displayName = 'LsxListView';
