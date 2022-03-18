import React, { FC, useEffect, useState } from 'react';
import { pagePathUtils } from '@growi/core';

import {
  useSiteUrl,
  useCurrentCreatedAt, useDeleteUsername, useDeletedAt, useHasChildren, useHasDraftOnHackmd,
  useIsDeleted, useIsNotCreatable, useIsTrashPage, useIsUserPage, useLastUpdateUsername,
  useCurrentPageId, usePageIdOnHackmd, usePageUser, useCurrentPagePath, useRevisionCreatedAt, useRevisionId, useRevisionIdHackmdSynced,
  useShareLinkId, useShareLinksNumber, useTemplateTagData, useCurrentUpdatedAt, useCreator, useRevisionAuthor, useCurrentUser, useTargetAndAncestors,
  useSlackChannels, useNotFoundTargetPathOrId, useIsSearchPage, useIsForbidden, useIsIdenticalPath,
  useIsAclEnabled, useIsSearchServiceConfigured, useIsSearchServiceReachable, useIsEnabledAttachTitleHeader, useIsNotFoundPermalink,
} from '../../stores/context';
import {
  useIsDeviceSmallerThanMd, useIsDeviceSmallerThanLg,
  usePreferDrawerModeByUser, usePreferDrawerModeOnEditByUser, useSidebarCollapsed, useCurrentSidebarContents, useCurrentProductNavWidth,
  useSelectedGrant, useSelectedGrantGroupId, useSelectedGrantGroupName,
} from '~/stores/ui';
import { useSetupGlobalSocket } from '~/stores/websocket';
import { IUserUISettings } from '~/interfaces/user-ui-settings';

const { isTrashPage: _isTrashPage } = pagePathUtils;

const jsonNull = 'null';

const ContextExtractorOnce: FC = () => {

  const mainContent = document.querySelector('#content-main');
  const notFoundContentForPt = document.getElementById('growi-pagetree-not-found-context');
  const notFoundContent = document.getElementById('growi-not-found-context');
  const forbiddenContent = document.getElementById('forbidden-page');

  /*
   * App Context from DOM
   */
  const currentUser = JSON.parse(document.getElementById('growi-current-user')?.textContent || jsonNull);

  /*
   * Settings from context-hydrate DOM
   */
  const configByContextHydrate = JSON.parse(document.getElementById('growi-context-hydrate')?.textContent || jsonNull);

  /*
   * UserUISettings from DOM
   */
  const userUISettings: Partial<IUserUISettings> = JSON.parse(document.getElementById('growi-user-ui-settings')?.textContent || jsonNull);

  /*
   * Page Context from DOM
   */
  const revisionId = mainContent?.getAttribute('data-page-revision-id');
  const path = decodeURI(mainContent?.getAttribute('data-path') || '');
  const pageId = mainContent?.getAttribute('data-page-id') || null;
  const revisionCreatedAt = +(mainContent?.getAttribute('data-page-revision-created') || '');

  // createdAt
  const createdAtAttribute = mainContent?.getAttribute('data-page-created-at');
  const createdAt: Date | null = (createdAtAttribute != null) ? new Date(createdAtAttribute) : null;
  // updatedAt
  const updatedAtAttribute = mainContent?.getAttribute('data-page-updated-at');
  const updatedAt: Date | null = (updatedAtAttribute != null) ? new Date(updatedAtAttribute) : null;

  const deletedAt = mainContent?.getAttribute('data-page-deleted-at') || null;
  const isIdenticalPath = JSON.parse(mainContent?.getAttribute('data-identical-path') || jsonNull) ?? false;
  const isUserPage = JSON.parse(mainContent?.getAttribute('data-page-user') || jsonNull) != null;
  const isTrashPage = _isTrashPage(path);
  const isDeleted = JSON.parse(mainContent?.getAttribute('data-page-is-deleted') || jsonNull) ?? false;
  const isNotCreatable = JSON.parse(mainContent?.getAttribute('data-page-is-not-creatable') || jsonNull) ?? false;
  const isForbidden = forbiddenContent != null;
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
  const targetAndAncestors = JSON.parse(document.getElementById('growi-pagetree-target-and-ancestors')?.textContent || jsonNull);
  const notFoundTargetPathOrId = JSON.parse(notFoundContentForPt?.getAttribute('data-not-found-target-path-or-id') || jsonNull);
  const isNotFoundPermalink = JSON.parse(notFoundContent?.getAttribute('data-is-not-found-permalink') || jsonNull);
  const slackChannels = mainContent?.getAttribute('data-slack-channels') || '';
  const isSearchPage = document.getElementById('search-page') != null;

  const grant = +(mainContent?.getAttribute('data-page-grant') || 1);
  const grantGroupId = mainContent?.getAttribute('data-page-grant-group') || null;
  const grantGroupName = mainContent?.getAttribute('data-page-grant-group-name') || null;

  /*
   * use static swr
   */
  // App
  useCurrentUser(currentUser);

  // UserUISettings
  usePreferDrawerModeByUser(userUISettings?.preferDrawerModeByUser);
  usePreferDrawerModeOnEditByUser(userUISettings?.preferDrawerModeOnEditByUser);
  useSidebarCollapsed(userUISettings?.isSidebarCollapsed);
  useCurrentSidebarContents(userUISettings?.currentSidebarContents);
  useCurrentProductNavWidth(userUISettings?.currentProductNavWidth);

  // hydrated config
  useSiteUrl(configByContextHydrate.crowi.url);
  useIsAclEnabled(configByContextHydrate.isAclEnabled);
  useIsSearchServiceConfigured(configByContextHydrate.isSearchServiceConfigured);
  useIsSearchServiceReachable(configByContextHydrate.isSearchServiceReachable);
  useIsEnabledAttachTitleHeader(configByContextHydrate.isEnabledAttachTitleHeader);


  // Page
  useCurrentCreatedAt(createdAt);
  useDeleteUsername(deleteUsername);
  useDeletedAt(deletedAt);
  useHasChildren(hasChildren);
  useHasDraftOnHackmd(hasDraftOnHackmd);
  useIsIdenticalPath(isIdenticalPath);
  useIsDeleted(isDeleted);
  useIsNotCreatable(isNotCreatable);
  useIsForbidden(isForbidden);
  useIsTrashPage(isTrashPage);
  useIsUserPage(isUserPage);
  useLastUpdateUsername(lastUpdateUsername);
  useCurrentPageId(pageId);
  usePageIdOnHackmd(pageIdOnHackmd);
  usePageUser(pageUser);
  useCurrentPagePath(path);
  useRevisionCreatedAt(revisionCreatedAt);
  useRevisionId(revisionId);
  useRevisionIdHackmdSynced(revisionIdHackmdSynced);
  useShareLinkId(shareLinkId);
  useShareLinksNumber(shareLinksNumber);
  useTemplateTagData(templateTagData);
  useCurrentUpdatedAt(updatedAt);
  useCreator(creator);
  useRevisionAuthor(revisionAuthor);
  useTargetAndAncestors(targetAndAncestors);
  useNotFoundTargetPathOrId(notFoundTargetPathOrId);
  useIsNotFoundPermalink(isNotFoundPermalink);
  useIsSearchPage(isSearchPage);

  // Navigation
  usePreferDrawerModeByUser();
  usePreferDrawerModeOnEditByUser();
  useIsDeviceSmallerThanMd();

  // Navigation
  usePreferDrawerModeByUser();
  usePreferDrawerModeOnEditByUser();
  useIsDeviceSmallerThanMd();

  // Editor
  useSlackChannels(slackChannels);
  useSelectedGrant(grant);
  useSelectedGrantGroupId(grantGroupId);
  useSelectedGrantGroupName(grantGroupName);

  // SearchResult
  useIsDeviceSmallerThanLg();

  // Global Socket
  useSetupGlobalSocket();

  return null;
};

const ContextExtractor: FC = React.memo(() => {
  const [isRunOnce, setRunOnce] = useState(false);

  useEffect(() => {
    setRunOnce(true);
  }, []);

  return isRunOnce ? null : <ContextExtractorOnce></ContextExtractorOnce>;
});

export default ContextExtractor;
