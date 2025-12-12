import { pagePathUtils } from '@growi/core/dist/utils';
import { atom, useAtomValue } from 'jotai';

import {
  _atomsForDerivedAbilities as contextAtoms,
  useIsSharedUser,
} from '~/states/context';
import { _atomsForDerivedAbilities as globalAtoms } from '~/states/global';
// Import internal atoms with special naming
import {
  _atomsForDerivedAbilities as pageAtoms,
  useCurrentPageId,
  useCurrentPagePath,
  useIsEditable,
  usePageNotFound,
} from '~/states/page';
import {
  EditorMode,
  _atomsForDerivedAbilities as editorAtoms,
} from '~/states/ui/editor';

const { isTrashTopPage, isUsersTopPage } = pagePathUtils;

// Derived atom for TagLabel display ability
const isAbleToShowTagLabelAtom = atom((get) => {
  const isNotFound = get(pageAtoms.pageNotFoundAtom);
  const currentPagePath = get(pageAtoms.currentPagePathAtom);
  const isIdenticalPath = get(pageAtoms.isIdenticalPathAtom);
  const shareLinkId = get(pageAtoms.shareLinkIdAtom);
  const editorMode = get(editorAtoms.editorModeAtom);

  // Return false if any dependency is undefined
  if (
    [currentPagePath, isIdenticalPath, isNotFound, editorMode].some(
      (v) => v === undefined,
    )
  ) {
    return false;
  }

  const isViewMode = editorMode === EditorMode.View;

  // "/trash" page does not exist on page collection and unable to add tags
  return (
    !isUsersTopPage(currentPagePath!) &&
    !isTrashTopPage(currentPagePath!) &&
    shareLinkId == null &&
    !isIdenticalPath &&
    !(isViewMode && isNotFound)
  );
});

/**
 * True if the current user can see TagLabel
 */
export const useIsAbleToShowTagLabel = (): boolean => {
  return useAtomValue(isAbleToShowTagLabelAtom);
};

// Derived atom for TrashPageManagementButtons display ability
const isAbleToShowTrashPageManagementButtonsAtom = atom((get) => {
  const currentUser = get(globalAtoms.currentUserAtom);
  const currentPageId = get(pageAtoms.currentPageIdAtom);
  const isNotFound = get(pageAtoms.pageNotFoundAtom);
  const isTrashPage = get(pageAtoms.isTrashPageAtom);
  const isReadOnlyUser = get(contextAtoms.isReadOnlyUserAtom);

  // Return false if any dependency is undefined
  if (
    [currentUser, currentPageId, isNotFound, isReadOnlyUser, isTrashPage].some(
      (v) => v === undefined,
    )
  ) {
    return false;
  }

  const isCurrentUserExist = currentUser != null;
  const isPageExist = currentPageId != null && isNotFound === false;
  const isTrashPageCondition = isPageExist && isTrashPage === true;
  const isReadOnlyUserCondition = isPageExist && isReadOnlyUser === true;

  return isTrashPageCondition && isCurrentUserExist && !isReadOnlyUserCondition;
});

/**
 * True if the current user can see TrashPageManagementButtons
 */
export const useIsAbleToShowTrashPageManagementButtons = (): boolean => {
  return useAtomValue(isAbleToShowTrashPageManagementButtonsAtom);
};

// Derived atom for PageManagement display ability
const isAbleToShowPageManagementAtom = atom((get) => {
  const currentPageId = get(pageAtoms.currentPageIdAtom);
  const isNotFound = get(pageAtoms.pageNotFoundAtom);
  const isTrashPage = get(pageAtoms.isTrashPageAtom);
  const isSharedUser = get(contextAtoms.isSharedUserAtom);

  const pageId = currentPageId;

  // Return false if any dependency is undefined
  if (
    [pageId, isTrashPage, isSharedUser, isNotFound].some((v) => v === undefined)
  ) {
    return false;
  }

  const isPageExist = pageId != null && isNotFound === false;
  const isEmptyPage = pageId != null && isNotFound === true;
  const isTrashPageCondition = isPageExist && isTrashPage === true;
  const isSharedUserCondition = isPageExist && isSharedUser === true;

  return (
    (isPageExist && !isTrashPageCondition && !isSharedUserCondition) ||
    isEmptyPage
  );
});

/**
 * True if the current user can see PageManagement
 */
export const useIsAbleToShowPageManagement = (): boolean => {
  return useAtomValue(isAbleToShowPageManagementAtom);
};

/**
 * True if the current user can change editor mode
 */
export const useIsAbleToChangeEditorMode = (): boolean => {
  const isEditable = useIsEditable();
  const isSharedUser = useIsSharedUser();

  const includesUndefined = [isEditable, isSharedUser].some(
    (v) => v === undefined,
  );
  if (includesUndefined) return false;

  return !!isEditable && !isSharedUser;
};

/**
 * True if the current user can see PageAuthors
 */
export const useIsAbleToShowPageAuthors = (): boolean => {
  const pageId = useCurrentPageId();
  const isNotFound = usePageNotFound();
  const pagePath = useCurrentPagePath();

  const includesUndefined = [pageId, pagePath, isNotFound].some(
    (v) => v === undefined,
  );
  if (includesUndefined) return false;

  const isPageExist = pageId != null && !isNotFound;
  const isUsersTopPagePath = pagePath != null && isUsersTopPage(pagePath);

  return isPageExist && !isUsersTopPagePath;
};
