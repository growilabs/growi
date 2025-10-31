import { useRouter } from 'next/router';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import { currentUserAtomGetter, growiCloudUriAtomGetter } from './global';

/**
 * Computed atom for checking if current user is a guest user
 * Depends on currentUser atom
 */
const isGuestUserAtom = atom((get) => {
  const currentUser = get(currentUserAtomGetter);
  return currentUser?._id == null;
});

// export const useIsGuestUser = () => {
//   return useAtom(isGuestUserAtom);
// };
export const useIsGuestUser = () => useAtomValue(isGuestUserAtom);

/**
 * Computed atom for checking if current user is a read-only user
 * Depends on currentUser and isGuestUser atoms
 */
const isReadOnlyUserAtom = atom((get) => {
  const currentUser = get(currentUserAtomGetter);
  const isGuestUser = get(isGuestUserAtom);

  return !isGuestUser && !!currentUser?.readOnly;
});

export const useIsReadOnlyUser = () => useAtomValue(isReadOnlyUserAtom);

/**
 * Computed atom for checking if current user is an admin
 * Depends on currentUser atom
 */
const isAdminAtom = atom((get) => {
  const currentUser = get(currentUserAtomGetter);
  return currentUser?.admin ?? false;
});

export const useIsAdmin = () => useAtomValue(isAdminAtom);

/**
 * Atom for checking if current user is a shared user
 */
const isSharedUserAtom = atom<boolean>(false);

export const useIsSharedUser = () => useAtomValue(isSharedUserAtom);

/**
 * Atom for checking if current page is a search page
 */
const isSearchPageAtom = atom<boolean | null>(null);
/**
 * Hook for getting the current search page state
 */
export const useIsSearchPage = () => useAtomValue(isSearchPageAtom);
/**
 * Hook for setting the current search page state
 */
export const useSetSearchPage = () => useSetAtom(isSearchPageAtom);

/**
 * Computed atom for GROWI documentation URL
 * Depends on growiCloudUri atom
 */
const growiDocumentationUrlAtom = atom((get) => {
  const growiCloudUri = get(growiCloudUriAtomGetter);

  if (growiCloudUri != null) {
    const url = new URL('/help', growiCloudUri);
    return url.toString();
  }

  return 'https://docs.growi.org';
});

export const useGrowiDocumentationUrl = () =>
  useAtomValue(growiDocumentationUrlAtom);

/**
 * Hook to get revisionId from URL query parameters
 * Returns undefined if revisionId is not present in the URL
 */
export const useRevisionIdFromUrl = (): string | undefined => {
  const router = useRouter();
  const revisionId = router.query.revisionId;
  return typeof revisionId === 'string' ? revisionId : undefined;
};

/**
 * Hook to check if user is intentionally viewing a specific (old) revision
 * Returns true when URL has ?revisionId=xxx parameter
 * This indicates the user explicitly wants to see that revision
 */
export const useIsViewingSpecificRevision = (): boolean => {
  const revisionId = useRevisionIdFromUrl();
  return revisionId != null;
};

/**
 * Internal atoms for derived atom usage (special naming convention)
 * These atoms are exposed only for creating derived atoms in other modules
 */
export const _atomsForDerivedAbilities = {
  isReadOnlyUserAtom,
  isSharedUserAtom,
} as const;
