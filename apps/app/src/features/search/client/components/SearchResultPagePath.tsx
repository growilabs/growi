import type { JSX } from 'react';
import { Fragment } from 'react';

import type { PagePathPart } from '~/client/util/format-truncated-page-path';
import { formatTruncatedPagePath } from '~/client/util/format-truncated-page-path';

import { useFittingCollapseLevel } from '../hooks/use-fitting-collapse-level';
import { PathSeparator } from './PathSeparator';
import {
  FIXED_PART_CLASS_NAME,
  PAGE_NAME_CLASS_NAME,
  ROW_CLASS_NAME,
} from './truncated-path-row-classes';

import styles from './SearchResultPagePath.module.scss';

interface SearchResultPagePathProps {
  readonly path: string;
}

interface KeyedPart {
  readonly part: PagePathPart;
  readonly key: string;
}

// Build a stable, unique key per part from the cumulative path prefix, so keys
// stay unique even when two ancestors share the same text (no array index).
const toKeyedParts = (parts: readonly PagePathPart[]): readonly KeyedPart[] => {
  const keyed: KeyedPart[] = [];
  let prefix = '';
  for (const part of parts) {
    prefix =
      part.type === 'ellipsis' ? `${prefix}/…` : `${prefix}/${part.text}`;
    keyed.push({ part, key: prefix });
  }
  return keyed;
};

/**
 * Renders a page path on a single line with Notion-style middle truncation. It
 * owns only the path span; click-through and footprint rendering stay in the
 * surrounding row component.
 *
 * When the base form does not fit, ancestors are folded into the ellipsis one
 * by one (the parent last); a character-truncated page name also counts as not
 * fitting. Only once every ancestor is folded is the page name left to its CSS
 * ellipsis. The container's width must come from the parent, not its content.
 *
 * The full path is always exposed via the native `title` attribute so a
 * shortened path can be inspected on hover. Ancestor segments are never
 * character-truncated; only the page name is.
 */
export const SearchResultPagePath = ({
  path,
}: SearchResultPagePathProps): JSX.Element => {
  const { maxCollapseLevel } = formatTruncatedPagePath(path);
  const { containerRef, shrinkableRef, collapseLevel } =
    useFittingCollapseLevel(maxCollapseLevel, path);
  const { isRoot, parts, fullPath } = formatTruncatedPagePath(
    path,
    collapseLevel,
  );

  return (
    <span
      ref={containerRef}
      className={`${styles['search-result-page-path']} ${ROW_CLASS_NAME}`}
      title={fullPath}
    >
      {isRoot ? (
        <PathSeparator className={styles.separator} />
      ) : (
        // A separator precedes every part, producing the leading '/' plus the
        // '/' separators between parts.
        toKeyedParts(parts).map(({ part, key }) => (
          <Fragment key={key}>
            <PathSeparator className={styles.separator} />
            {part.type === 'ellipsis' ? (
              <span className={`${FIXED_PART_CLASS_NAME} text-muted`}>…</span>
            ) : part.isPageName ? (
              <strong
                ref={shrinkableRef}
                className={`${styles['page-name']} ${PAGE_NAME_CLASS_NAME}`}
              >
                {part.text}
              </strong>
            ) : (
              <span className={FIXED_PART_CLASS_NAME}>{part.text}</span>
            )}
          </Fragment>
        ))
      )}
    </span>
  );
};
