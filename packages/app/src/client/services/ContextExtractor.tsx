import React, { FC } from 'react';
import { pagePathUtils } from '@growi/core';

import {
  useCreatedAt, useDeleteUsername, useDeletedAt, useHasChildren, useHasDraftOnHackmd, useIsAbleToDeleteCompletely,
  useIsDeletable, useIsDeleted, useIsNotCreatable, useIsPageExist, useIsTrashPage, useIsUserPage, useLastUpdateUsername,
  usePageId, usePageIdOnHackmd, usePageUser, useCurrentPagePath, useRevisionCreatedAt, useRevisionId, useRevisionIdHackmdSynced,
  useShareLinkId, useShareLinksNumber, useTemplateTagData, useUpdatedAt, useCreator, useRevisionAuthor, useCurrentUser,
} from '../../stores/context';

const { isTrashPage: _isTrashPage } = pagePathUtils;

const jsonNull = 'null';

const ContextExtractor: FC = () => {

  const mainContent = document.querySelector('#content-main');

  /*
   * App Context from DOM
   */
  const currentUser = JSON.parse(document.getElementById('growi-current-user')?.textContent || jsonNull);

  /*
   * Page Context from DOM
   */
  const revisionId = mainContent?.getAttribute('data-page-revision-id');
  const path = decodeURI(mainContent?.getAttribute('data-path') || '');
  const pageId = mainContent?.getAttribute('data-page-id') || null;
  const revisionCreatedAt = +(mainContent?.getAttribute('data-page-revision-created') || '');
  const createdAt = mainContent?.getAttribute('data-page-created-at');
  const updatedAt = mainContent?.getAttribute('data-page-updated-at');
  const deletedAt = mainContent?.getAttribute('data-page-deleted-at') || null;
  const isUserPage = JSON.parse(mainContent?.getAttribute('data-page-user') || jsonNull);
  const isTrashPage = _isTrashPage(path);
  const isDeleted = JSON.parse(mainContent?.getAttribute('data-page-is-deleted') || jsonNull);
  const isDeletable = JSON.parse(mainContent?.getAttribute('data-page-is-deletable') || jsonNull);
  const isNotCreatable = JSON.parse(mainContent?.getAttribute('data-page-is-not-creatable') || jsonNull);
  const isAbleToDeleteCompletely = JSON.parse(mainContent?.getAttribute('data-page-is-able-to-delete-completely') || jsonNull);
  const isPageExist = mainContent?.getAttribute('data-page-id') != null;
  const pageUser = JSON.parse(mainContent?.getAttribute('data-page-user') || jsonNull);
  const hasChildren = JSON.parse(mainContent?.getAttribute('data-page-has-children') || jsonNull);
  const templateTagData = mainContent?.getAttribute('data-template-tags') || null;
  const shareLinksNumber = mainContent?.getAttribute('data-share-links-number');
  const shareLinkId = JSON.parse(mainContent?.getAttribute('data-share-link-id') || jsonNull);
  const revisionIdHackmdSynced = mainContent?.getAttribute('data-page-revision-id-hackmd-synced') || null;
  const lastUpdateUsername = mainContent?.getAttribute('data-page-last-update-username') || null;
  const deleteUsername = mainContent?.getAttribute('data-page-delete-username') || null;
  const pageIdOnHackmd = mainContent?.getAttribute('data-page-id-on-hackmd') || null;
  const hasDraftOnHackmd = !!mainContent?.getAttribute('data-page-has-draft-on-hackmd');
  const creator = JSON.parse(mainContent?.getAttribute('data-page-creator') || jsonNull);
  const revisionAuthor = JSON.parse(mainContent?.getAttribute('data-page-revision-author') || jsonNull);

  /*
   * use static swr
   */
  // App
  useCurrentUser(currentUser);

  // Page
  useCreatedAt(createdAt);
  useDeleteUsername(deleteUsername);
  useDeletedAt(deletedAt);
  useHasChildren(hasChildren);
  useHasDraftOnHackmd(hasDraftOnHackmd);
  useIsAbleToDeleteCompletely(isAbleToDeleteCompletely);
  useIsDeletable(isDeletable);
  useIsDeleted(isDeleted);
  useIsNotCreatable(isNotCreatable);
  useIsPageExist(isPageExist);
  useIsTrashPage(isTrashPage);
  useIsUserPage(isUserPage);
  useLastUpdateUsername(lastUpdateUsername);
  usePageId(pageId);
  usePageIdOnHackmd(pageIdOnHackmd);
  usePageUser(pageUser);
  useCurrentPagePath(path);
  useRevisionCreatedAt(revisionCreatedAt);
  useRevisionId(revisionId);
  useRevisionIdHackmdSynced(revisionIdHackmdSynced);
  useShareLinkId(shareLinkId);
  useShareLinksNumber(shareLinksNumber);
  useTemplateTagData(templateTagData);
  useUpdatedAt(updatedAt);
  useCreator(creator);
  useRevisionAuthor(revisionAuthor);

  return (
    <div>
      {/* Render nothing */}
    </div>
  );
};

export default ContextExtractor;
