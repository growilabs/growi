import type { FC, JSX } from 'react';
import { Fragment } from 'react';
import Link from 'next/link';
import { pagePathUtils } from '@growi/core/dist/utils';

import type { AncestorPathNode } from '~/client/util/build-ancestor-path-nodes';
import { buildAncestorPathNodes } from '~/client/util/build-ancestor-path-nodes';

import { PathSeparator } from './PathSeparator';

import styles from './SearchResultAncestorPath.module.scss';

const { isTrashPage } = pagePathUtils;

interface SearchResultAncestorPathProps {
  readonly path: string;
  readonly highlightedPath?: string | null;
}

// Mirrors PagePathHierarchicalLink's `isRoot` branch (home/trash icon + link).
// Deliberately duplicated rather than shared/extracted — PagePathHierarchicalLink
// is treated as stable/unmodified by this spec (see research.md "Root-icon
// duplication vs. extraction").
const RootIcon = ({
  isInTrash,
}: {
  readonly isInTrash: boolean;
}): JSX.Element =>
  isInTrash ? (
    <span className="path-segment">
      <Link href="/trash" prefetch={false}>
        <span
          className={`material-symbols-outlined ${styles['material-symbols-outlined']}`}
        >
          delete
        </span>
      </Link>
    </span>
  ) : (
    <span className="path-segment">
      <Link href="/" prefetch={false}>
        <span
          className={`material-symbols-outlined ${styles['material-symbols-outlined']}`}
        >
          home
        </span>
      </Link>
    </span>
  );

// A surviving ancestor segment (`link`) is rendered as a next/link, either as
// plain text or, when a corresponding highlight was resolved, with the
// Elasticsearch <em> markup applied. `ellipsis` renders as plain, non-link text
// (Requirement 5.2: the ellipsis is never itself a navigation target).
const AncestorNode = ({
  node,
}: {
  readonly node: AncestorPathNode;
}): JSX.Element => {
  if (node.type === 'ellipsis') {
    return <span className={`${styles.ellipsis} text-muted`}>…</span>;
  }

  return (
    <Link href={node.href} prefetch={false} className={styles.segment}>
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
// most one ellipsis node ever appears in a plan, so a constant key is safe.
const nodeKey = (node: AncestorPathNode): string =>
  node.type === 'ellipsis' ? 'ellipsis' : node.href;

/**
 * Presentational component that renders the ancestor-path portion of a search
 * result row on a single line, with Notion-style middle truncation. Surviving
 * ancestor segments stay individually clickable and keep search-keyword
 * highlighting; the page name itself is rendered separately by the caller
 * (see research.md "Row 1 vs Row 2 scope").
 *
 * The full path (including the page name) is always exposed via the native
 * `title` attribute so it can be inspected on hover, regardless of whether the
 * row is currently truncated.
 */
export const SearchResultAncestorPath: FC<SearchResultAncestorPathProps> = ({
  path,
  highlightedPath,
}) => {
  const { hasAncestors, nodes, fullPath } = buildAncestorPathNodes(
    path,
    highlightedPath,
  );
  const isInTrash = isTrashPage(path);

  return (
    <span className={styles['search-result-ancestor-path']} title={fullPath}>
      <RootIcon isInTrash={isInTrash} />
      {hasAncestors &&
        nodes.map((node) => (
          <Fragment key={nodeKey(node)}>
            <PathSeparator className={styles.separator} />
            <AncestorNode node={node} />
          </Fragment>
        ))}
    </span>
  );
};
