import { useCallback, useMemo } from 'react';
import {
  isCreatablePage,
  isPermalink,
} from '@growi/core/dist/utils/page-path-utils';
import { useAtomValue, useSetAtom } from 'jotai';
import { useAtomCallback } from 'jotai/utils';

import { useIsGuestUser, useIsReadOnlyUser } from '../context';
import { useCurrentPathname } from '../global';
import {
  currentPageDataAtom,
  currentPageEmptyIdAtom,
  currentPageEntityIdAtom,
  currentPagePathAtom,
  isForbiddenAtom,
  isIdenticalPathAtom,
  isTrashPageAtom,
  isUntitledPageAtom,
  pageNotFoundAtom,
  redirectFromAtom,
  remoteRevisionBodyAtom,
  remoteRevisionLastUpdatedAtAtom,
  remoteRevisionLastUpdateUserAtom,
  revisionIdFromUrlAtom,
  shareLinkIdAtom,
  templateBodyAtom,
  templateTagsAtom,
} from './internal-atoms';

/**
 * Public hooks for page state management
 * These provide a clean interface while hiding internal atom implementation
 */

// Read-only hooks for page state
export const useCurrentPageId = (includeEmpty: boolean = false) => {
  const entityPageId = useAtomValue(currentPageEntityIdAtom);
  const emptyPageId = useAtomValue(currentPageEmptyIdAtom);

  return includeEmpty ? (entityPageId ?? emptyPageId) : entityPageId;
};

export const useCurrentPageData = () => useAtomValue(currentPageDataAtom);

export const usePageNotFound = (includeEmpty: boolean = true) => {
  const isPageNotFound = useAtomValue(pageNotFoundAtom);
  const emptyPageId = useAtomValue(currentPageEmptyIdAtom);

  return includeEmpty ? isPageNotFound || emptyPageId != null : isPageNotFound;
};

export const useIsIdenticalPath = () => useAtomValue(isIdenticalPathAtom);

export const useIsForbidden = () => useAtomValue(isForbiddenAtom);

export const useShareLinkId = () => useAtomValue(shareLinkIdAtom);

export const useTemplateTags = () => useAtomValue(templateTagsAtom);

export const useTemplateBody = () => useAtomValue(templateBodyAtom);

/**
 * Hook to get revisionId from URL query parameters
 * Returns undefined if revisionId is not present in the URL
 *
 * This hook reads from the revisionIdFromUrlAtom which should be updated
 * by the page component when router.query.revisionId changes
 */
export const useRevisionIdFromUrl = () => useAtomValue(revisionIdFromUrlAtom);

// Remote revision hooks (replacements for stores/remote-latest-page.ts)
export const useRemoteRevisionBody = () => useAtomValue(remoteRevisionBodyAtom);

export const useRemoteRevisionLastUpdateUser = () =>
  useAtomValue(remoteRevisionLastUpdateUserAtom);

export const useRemoteRevisionLastUpdatedAt = () =>
  useAtomValue(remoteRevisionLastUpdatedAtAtom);

export const useRedirectFrom = () => useAtomValue(redirectFromAtom);

// Enhanced computed hooks (pure Jotai - no SWR needed)

/**
 * Get current page path with fallback to pathname
 * Pure Jotai replacement for stores/page.tsx useCurrentPagePath
 */
export const useCurrentPagePath = (): string | undefined => {
  const currentPagePath = useAtomValue(currentPagePathAtom);
  const currentPathname = useCurrentPathname();

  if (currentPagePath != null) {
    return currentPagePath;
  }
  if (currentPathname != null && !isPermalink(currentPathname)) {
    return currentPathname;
  }
  return undefined;
};

/**
 * Check if current page is in trash
 * Pure Jotai replacement for stores/page.tsx useIsTrashPage
 */
export const useIsTrashPage = (): boolean => useAtomValue(isTrashPageAtom);

/**
 * Computed hook for checking if current page is creatable
 */
export const useIsNotCreatable = (): boolean => {
  const isNotFound = useAtomValue(pageNotFoundAtom);
  const pagePath = useCurrentPagePath();
  return isNotFound && (pagePath == null ? true : !isCreatablePage(pagePath));
};

/**
 * Computed hook for checking if current page is editable
 */
export const useIsEditable = () => {
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isNotCreatable = useIsNotCreatable();

  const getCombinedConditions = useAtomCallback(
    useCallback((get) => {
      const isForbidden = get(isForbiddenAtom);
      const isIdenticalPath = get(isIdenticalPathAtom);

      return !isForbidden && !isIdenticalPath;
    }, []),
  );

  return useMemo(() => {
    return (
      !isGuestUser &&
      !isReadOnlyUser &&
      !isNotCreatable &&
      getCombinedConditions()
    );
  }, [getCombinedConditions, isGuestUser, isReadOnlyUser, isNotCreatable]);
};

/**
 * Hook to get untitled page status
 * Returns true if current page is in untitled state, false otherwise
 * Returns false if no page is currently loaded (currentPageId is null)
 */
export const useIsUntitledPage = () => useAtomValue(isUntitledPageAtom);

/**
 * Hook to set untitled page status
 * Only updates state when a page is currently loaded (currentPageId exists)
 */
export const useSetIsUntitledPage = () => useSetAtom(isUntitledPageAtom);
