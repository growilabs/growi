import type { IPagePopulatedToShowRevision, IUserHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { atom } from 'jotai';

/**
 * Internal atoms for page state management
 * These should not be imported directly by external modules
 */

// Core page state atoms (internal)
export const currentPageIdAtom = atom<string>();
export const currentPageDataAtom = atom<IPagePopulatedToShowRevision>();
export const pageNotFoundAtom = atom(false);
export const isIdenticalPathAtom = atom<boolean>(false);
export const isForbiddenAtom = atom<boolean>(false);
export const latestRevisionAtom = atom(true);

// ShareLink page state atoms (internal)
export const shareLinkIdAtom = atom<string>();

// Fetch state atoms (internal)
export const pageLoadingAtom = atom(false);
export const pageErrorAtom = atom<Error | null>(null);

// Template data atoms (internal)
export const templateTagsAtom = atom<string[]>([]);
export const templateBodyAtom = atom<string>('');

// Derived atoms for computed states
export const currentPagePathAtom = atom((get) => {
  const currentPage = get(currentPageDataAtom);
  return currentPage?.path;
});

// Additional computed atoms for migrated hooks
export const currentRevisionIdAtom = atom((get) => {
  const currentPage = get(currentPageDataAtom);
  return currentPage?.revision?._id;
});

// Base atom for untitled page state management
const untitledPageStateAtom = atom<boolean>(false);

// Derived atom for untitled page state with currentPageId dependency
export const isUntitledPageAtom = atom(
  (get) => {
    const currentPageId = get(currentPageIdAtom);
    // If no current page ID exists, return false (no page loaded)
    if (currentPageId == null) {
      return false;
    }
    // Return the current untitled state when page ID exists
    return get(untitledPageStateAtom);
  },
  (get, set, newValue: boolean) => {
    const currentPageId = get(currentPageIdAtom);
    // Only update state if current page ID exists
    if (currentPageId != null) {
      set(untitledPageStateAtom, newValue);
    }
  },
);

// Remote revision data atoms
export const remoteRevisionIdAtom = atom<string>();
export const remoteRevisionBodyAtom = atom<string>();
export const remoteRevisionLastUpdateUserAtom = atom<IUserHasId>();
export const remoteRevisionLastUpdatedAtAtom = atom<Date>();

// Enhanced computed atoms that replace SWR-based hooks
export const isTrashPageAtom = atom((get) => {
  const pagePath = get(currentPagePathAtom);
  return pagePath != null ? pagePathUtils.isTrashPage(pagePath) : false;
});

export const isRevisionOutdatedAtom = atom((get) => {
  const currentRevisionId = get(currentRevisionIdAtom);
  const remoteRevisionId = get(remoteRevisionIdAtom);

  if (currentRevisionId == null || remoteRevisionId == null) {
    return false;
  }

  return remoteRevisionId !== currentRevisionId;
});

export const setPageStatusAtom = atom(
  null,
  (get, set, status: { isNotFound?: boolean; isLatestRevision?: boolean }) => {
    if (status.isNotFound !== undefined) {
      set(pageNotFoundAtom, status.isNotFound);
    }
    if (status.isLatestRevision !== undefined) {
      set(latestRevisionAtom, status.isLatestRevision);
    }
  },
);

// Update atoms for template and remote revision data
export const setTemplateContentAtom = atom(
  null,
  (get, set, data: { tags?: string[]; body?: string }) => {
    if (data.tags !== undefined) {
      set(templateTagsAtom, data.tags);
    }
    if (data.body !== undefined) {
      set(templateBodyAtom, data.body);
    }
  },
);

export const setRemoteRevisionDataAtom = atom(
  null,
  (
    get,
    set,
    data: {
      id?: string;
      body?: string;
      lastUpdateUser?: IUserHasId;
      lastUpdatedAt?: Date;
    },
  ) => {
    if (data.id !== undefined) {
      set(remoteRevisionIdAtom, data.id);
    }
    if (data.body !== undefined) {
      set(remoteRevisionBodyAtom, data.body);
    }
    if (data.lastUpdateUser !== undefined) {
      set(remoteRevisionLastUpdateUserAtom, data.lastUpdateUser);
    }
    if (data.lastUpdatedAt !== undefined) {
      set(remoteRevisionLastUpdatedAtAtom, data.lastUpdatedAt);
    }
  },
);

/**
 * Atom for redirect from path
 */
export const redirectFromAtom = atom<string | undefined>(undefined);

/**
 * Internal atoms for derived atom usage (special naming convention)
 * These atoms are exposed only for creating derived atoms in other modules
 */
export const _atomsForDerivedAbilities = {
  pageNotFoundAtom,
  currentPagePathAtom,
  isIdenticalPathAtom,
  shareLinkIdAtom,
  currentPageIdAtom,
  isTrashPageAtom,
} as const;
