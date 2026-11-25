import type { IBacklinksIndexState } from '../../interfaces/backlink';

export type BacklinksIndexNotice =
  | { readonly kind: 'partial'; readonly coveredSince: string }
  | { readonly kind: 'building' }
  | null;

/**
 * Which gap the panel flags: any coverage short of `all`; an unread summary flags nothing.
 * Equivalent to design.md's "not `all` or a run is active", since no run is ever outstanding at `all`.
 */
export const toBacklinksIndexNotice = (
  indexState: IBacklinksIndexState | null,
): BacklinksIndexNotice => {
  if (indexState == null || indexState.coverage === 'all') return null;
  if (indexState.coverage === 'partial' && indexState.coveredSince != null) {
    return { kind: 'partial', coveredSince: indexState.coveredSince };
  }
  return { kind: 'building' };
};
