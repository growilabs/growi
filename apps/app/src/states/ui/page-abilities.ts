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
    // biome-ignore lint/style/noNonNullAssertion: currentPagePath should be defined here
    !isUsersTopPage(currentPagePath!) &&
    // biome-ignore lint/style/noNonNullAssertion: currentPagePath should be defined here
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
  const currentPageEntityId = get(pageAtoms.currentPageEntityIdAtom);
  const currentPageEmptyId = get(pageAtoms.currentPageEmptyIdAtom);
  const isTrashPage = get(pageAtoms.isTrashPageAtom);
  const isReadOnlyUser = get(contextAtoms.isReadOnlyUserAtom);

  const isCurrentUserExist = currentUser != null;
  const isPageExist = currentPageEntityId != null || currentPageEmptyId != null;
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
  const currentPageEntityId = get(pageAtoms.currentPageEntityIdAtom);
  const currentPageEmptyId = get(pageAtoms.currentPageEmptyIdAtom);
  const isTrashPage = get(pageAtoms.isTrashPageAtom);
  const isSharedUser = get(contextAtoms.isSharedUserAtom);

  const isPageExist = currentPageEntityId != null || currentPageEmptyId != null;
  const isTrashPageCondition = isPageExist && isTrashPage === true;
  const isSharedUserCondition = isPageExist && isSharedUser === true;

  return isPageExist && !isTrashPageCondition && !isSharedUserCondition;
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
  const pagePath = useCurrentPagePath();

  const includesUndefined = [pageId, pagePath].some((v) => v === undefined);
  if (includesUndefined) return false;

  const isPageExist = pageId != null;
  const isUsersTopPagePath = pagePath != null && isUsersTopPage(pagePath);

  return isPageExist && !isUsersTopPagePath;
};
