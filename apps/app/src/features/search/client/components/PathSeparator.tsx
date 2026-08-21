import type { JSX } from 'react';

interface PathSeparatorProps {
  /** The caller's own CSS-module-scoped class for the `.separator` rule. */
  readonly className: string;
}

/**
 * The `/` separator rendered between truncated-path segments. Shared by
 * `SearchResultPagePath` (search modal) and `SearchResultAncestorPath`
 * (search results list) -- each still supplies its own module-scoped
 * `.separator` class since CSS Modules hashes class names per file.
 */
export const PathSeparator = ({
  className,
}: PathSeparatorProps): JSX.Element => (
  <span className={`${className} text-muted`}>/</span>
);
