import type { JSX } from 'react';
import { Fragment, memo, useMemo } from 'react';
import Link from 'next/link';
import { pagePathUtils } from '@growi/core/dist/utils';

import type { AncestorPathNode } from '~/client/util/build-ancestor-path-nodes';
import { buildAncestorPathNodes } from '~/client/util/build-ancestor-path-nodes';
import { formatTruncatedPagePath } from '~/client/util/format-truncated-page-path';
import { PagePathHierarchicalLink } from '~/components/Common/PagePathHierarchicalLink';
import { LinkedPagePath } from '~/models/linked-page-path';

import { useFittingCollapseLevel } from '../hooks/use-fitting-collapse-level';
import { PathSeparator } from './PathSeparator';
import {
  FIXED_PART_CLASS_NAME,
  ROW_CLASS_NAME,
} from './truncated-path-row-classes';

import styles from './SearchResultAncestorPath.module.scss';

const { isTrashPage, isTrashTopPage } = pagePathUtils;

interface SearchResultAncestorPathProps {
  readonly path: string;
  readonly highlightedPath?: string | null;
}

// PagePathHierarchicalLink renders only its root branch (home/trash icon and
// the "/" after it) for the root node, so it is reused as-is for the row head.
const ROOT_LINKED_PAGE_PATH = new LinkedPagePath('/');

// A surviving ancestor segment (`link`) is rendered as a next/link, either as
// plain text or, when a corresponding highlight was resolved, with the
// Elasticsearch <em> markup applied. `ellipsis` renders as plain, non-link text
// (Requirement 5.2: the ellipsis is never itself a navigation target). Neither
// ever shrinks: an ancestor is shown in full or collapsed into the ellipsis.
const AncestorNode = ({
  node,
}: {
  readonly node: AncestorPathNode;
}): JSX.Element => {
  if (node.type === 'ellipsis') {
    return <span className={`${FIXED_PART_CLASS_NAME} text-muted`}>…</span>;
  }

  return (
    <Link href={node.href} prefetch={false} className={FIXED_PART_CLASS_NAME}>
      {node.highlightedHtml != null ? (
        <span
          // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight markup is sanitized
          dangerouslySetInnerHTML={{ __html: node.highlightedHtml }}
        />
      ) : (
        node.text
      )}
    </Link>
  );
};

// Stable key per node: link nodes are keyed by their (unique) href, and at
// most one ellipsis node ever appears in a plan at any collapse level, so a
// constant key is safe.
const nodeKey = (node: AncestorPathNode): string =>
  node.type === 'ellipsis' ? 'ellipsis' : node.href;

/**
 * Presentational component that renders the ancestor-path portion of a search
 * result row on a single line, with Notion-style middle truncation. When the
 * base form does not fit, ancestors are folded into the ellipsis one by one
 * (the parent last), following the same rule as the search modal. Since the
 * page name sits on its own row, nothing here is character-truncated. The
 * container's width must come from the parent, not its content. Surviving
 * ancestor segments stay individually clickable and keep search-keyword
 * highlighting; the page name itself is rendered separately by the caller
 * (see research.md "Row 1 vs Row 2 scope").
 *
 * The full path (including the page name) is always exposed via the native
 * `title` attribute so it can be inspected on hover, regardless of whether the
 * row is currently truncated.
 */
export const SearchResultAncestorPath = memo(
  ({ path, highlightedPath }: SearchResultAncestorPathProps): JSX.Element => {
    // The maximum level does not depend on the level itself
    const { maxCollapseLevel } = useMemo(
      () => formatTruncatedPagePath(path),
      [path],
    );
    const { containerRef, collapseLevel } = useFittingCollapseLevel(
      maxCollapseLevel,
      path,
    );
    const { nodes, fullPath } = useMemo(
      () => buildAncestorPathNodes(path, highlightedPath, collapseLevel),
      [path, highlightedPath, collapseLevel],
    );
    // Like PageListItemL's legacy row, the trash icon marks pages *inside*
    // /trash; the /trash page itself sits directly under the top page.
    const isInTrash = isTrashPage(path) && !isTrashTopPage(path);

    return (
      <span
        ref={containerRef}
        className={`${styles['search-result-ancestor-path']} ${ROW_CLASS_NAME}`}
        title={fullPath}
      >
        <PagePathHierarchicalLink
          linkedPagePath={ROOT_LINKED_PAGE_PATH}
          isInTrash={isInTrash}
        />
        {nodes.map((node, index) => (
          <Fragment key={nodeKey(node)}>
            {index > 0 && <PathSeparator className={styles.separator} />}
            <AncestorNode node={node} />
          </Fragment>
        ))}
      </span>
    );
  },
);
