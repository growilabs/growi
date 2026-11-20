import type { JSX, RefObject } from 'react';
import { Fragment, memo, useMemo } from 'react';

import type { PagePathPart } from '~/client/util/format-truncated-page-path';
import {
  formatTruncatedPagePath,
  parsePagePath,
} from '~/client/util/format-truncated-page-path';

import { usePathCollapseLevel } from '../hooks/use-path-collapse-level';
import { PathSeparator } from './PathSeparator';
import {
  FIXED_PART_CLASS_NAME,
  PAGE_NAME_CLASS_NAME,
  ROW_CLASS_NAME,
} from './truncated-path-row-classes';

import styles from './SearchResultPagePath.module.scss';

interface SearchResultPagePathProps {
  readonly path: string;
  /** Spacing from the caller (e.g. margins); the row sizes itself */
  readonly className?: string;
}

interface KeyedPart {
  readonly part: PagePathPart;
  readonly key: string;
}

// Build a stable, unique key per part from the cumulative path prefix, so keys
// stay unique even when two ancestors share the same text (no array index).
const toKeyedParts = (parts: readonly PagePathPart[]): readonly KeyedPart[] => {
  const labels = parts.map((part) =>
    part.type === 'ellipsis' ? '…' : part.text,
  );
  return parts.map((part, index) => ({
    part,
    key: `/${labels.slice(0, index + 1).join('/')}`,
  }));
};

const PAGE_NAME_CLASS = `${styles['page-name']} ${PAGE_NAME_CLASS_NAME}`;

interface PathPartViewProps {
  readonly part: PagePathPart;
  /** Attached to the page name so a character-truncated name counts as not fitting */
  readonly pageNameRef: RefObject<HTMLElement>;
}

const PathPartView = ({
  part,
  pageNameRef,
}: PathPartViewProps): JSX.Element => {
  if (part.type === 'ellipsis') {
    return <span className={`${FIXED_PART_CLASS_NAME} text-muted`}>…</span>;
  }
  if (part.isPageName) {
    return (
      <strong ref={pageNameRef} className={PAGE_NAME_CLASS}>
        {part.text}
      </strong>
    );
  }
  return <span className={FIXED_PART_CLASS_NAME}>{part.text}</span>;
};

/**
 * Renders a page path on a single line with Notion-style middle truncation. It
 * owns only the path span; click-through and footprint rendering stay in the
 * surrounding row component.
 *
 * When the base form does not fit, ancestors are folded into the ellipsis one
 * by one (the parent last); a character-truncated page name also counts as not
 * fitting. Only once every ancestor is folded is the page name left to its CSS
 * ellipsis. The row sizes itself to the free space of its flex parent, so the
 * caller places it directly in the layout (no sizing wrapper).
 *
 * The full path is always exposed via the native `title` attribute so a
 * shortened path can be inspected on hover. Ancestor segments are never
 * character-truncated; only the page name is.
 */
// Memoized: the search modal re-renders every row on each keystroke and on
// arrow-key navigation, and each render re-parses the path and re-measures it.
export const SearchResultPagePath = memo(
  ({ path, className }: SearchResultPagePathProps): JSX.Element => {
    const parsed = useMemo(() => parsePagePath(path), [path]);
    const { containerRef, shrinkableRef, collapseLevel } =
      usePathCollapseLevel(parsed);
    const { isRoot, parts, fullPath } = useMemo(
      () => formatTruncatedPagePath(parsed, collapseLevel),
      [parsed, collapseLevel],
    );

    return (
      <span
        ref={containerRef}
        className={`${styles['search-result-page-path']} ${ROW_CLASS_NAME} ${className ?? ''}`}
        title={fullPath}
      >
        {isRoot ? (
          // The root page's name is "/" itself, shown bold like other page names
          <strong className={PAGE_NAME_CLASS}>/</strong>
        ) : (
          // A separator precedes every part, producing the leading '/' plus the
          // '/' separators between parts.
          toKeyedParts(parts).map(({ part, key }) => (
            <Fragment key={key}>
              <PathSeparator className={styles.separator} />
              <PathPartView part={part} pageNameRef={shrinkableRef} />
            </Fragment>
          ))
        )}
      </span>
    );
  },
);
