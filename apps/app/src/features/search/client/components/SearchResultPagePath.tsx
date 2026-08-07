import type { JSX } from 'react';
import { Fragment } from 'react';

import type { PagePathPart } from '../utils/format-truncated-page-path';
import { formatTruncatedPagePath } from '../utils/format-truncated-page-path';

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

const Separator = (): JSX.Element => (
  <span className={`${styles.separator} text-muted`}>/</span>
);

/**
 * Presentational component that renders a page path on a single line with
 * Notion-style middle truncation. It owns only the path span; click-through and
 * footprint rendering stay in the surrounding row component.
 *
 * The full path is always exposed via the native `title` attribute so that a
 * truncated path (either the static middle omission or the runtime per-segment
 * CSS ellipsis) can be inspected on hover without measuring the DOM.
 */
export const SearchResultPagePath = ({
  path,
}: SearchResultPagePathProps): JSX.Element => {
  const { isRoot, parts, fullPath } = formatTruncatedPagePath(path);

  return (
    <span className={styles['search-result-page-path']} title={fullPath}>
      {isRoot ? (
        <Separator />
      ) : (
        // A separator precedes every part, producing the leading '/' plus the
        // '/' separators between parts.
        toKeyedParts(parts).map(({ part, key }) => (
          <Fragment key={key}>
            <Separator />
            {part.type === 'ellipsis' ? (
              <span className={`${styles.ellipsis} text-muted`}>…</span>
            ) : part.isPageName ? (
              <strong className={`${styles.segment} ${styles['page-name']}`}>
                {part.text}
              </strong>
            ) : (
              <span className={styles.segment}>{part.text}</span>
            )}
          </Fragment>
        ))
      )}
    </span>
  );
};
