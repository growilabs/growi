import { useCallback } from 'react';

import type { IPageHasId } from '@growi/core';
import { SubscriptionStatusType } from '@growi/core';
import urljoin from 'url-join';

import type { SyncLatestRevisionBody } from '~/interfaces/yjs';
import { useIsGuestUser } from '~/stores-universal/context';
import { useEditingMarkdown, usePageTagsForEditors } from '~/stores/editor';
import {
  useCurrentPageId, useSWRMUTxCurrentPage, useSWRxApplicableGrant, useSWRxTagsInfo,
  useSWRxCurrentGrantData,
} from '~/stores/page';
import { useSetRemoteLatestPageData } from '~/stores/remote-latest-page';
import loggerFactory from '~/utils/logger';

import { apiPost } from '../util/apiv1-client';
import { apiv3Get, apiv3Post, apiv3Put } from '../util/apiv3-client';
import { toastError } from '../util/toastr';

const logger = loggerFactory('growi:services:page-operation');


export const toggleSubscribe = async(pageId: string, currentStatus: SubscriptionStatusType | undefined): Promise<void> => {
  try {
    const newStatus = currentStatus === SubscriptionStatusType.SUBSCRIBE
      ? SubscriptionStatusType.UNSUBSCRIBE
      : SubscriptionStatusType.SUBSCRIBE;

    await apiv3Put('/page/subscribe', { pageId, status: newStatus });
  }
  catch (err) {
    toastError(err);
  }
};

export const toggleLike = async(pageId: string, currentValue?: boolean): Promise<void> => {
  try {
    await apiv3Put('/page/likes', { pageId, bool: !currentValue });
  }
  catch (err) {
    toastError(err);
  }
};

export const toggleBookmark = async(pageId: string, currentValue?: boolean): Promise<void> => {
  try {
    await apiv3Put('/bookmarks', { pageId, bool: !currentValue });
  }
  catch (err) {
    toastError(err);
  }
};

export const updateContentWidth = async(pageId: string, newValue: boolean): Promise<void> => {
  try {
    await apiv3Put(`/page/${pageId}/content-width`, { expandContentWidth: newValue });
  }
  catch (err) {
    toastError(err);
  }
};

export const bookmark = async(pageId: string): Promise<void> => {
  try {
    await apiv3Put('/bookmarks', { pageId, bool: true });
  }
  catch (err) {
    toastError(err);
  }
};

export const unbookmark = async(pageId: string): Promise<void> => {
  try {
    await apiv3Put('/bookmarks', { pageId, bool: false });
  }
  catch (err) {
    toastError(err);
  }
};

export const exportAsMarkdown = (pageId: string, revisionId: string, format: string): void => {
  const url = new URL(urljoin(window.location.origin, '_api/v3/page/export', pageId));
  url.searchParams.append('format', format);
  url.searchParams.append('revisionId', revisionId);
  window.location.href = url.href;
};

/**
 * send request to fix broken paths caused by unexpected events such as server shutdown while renaming page paths
 */
export const resumeRenameOperation = async(pageId: string): Promise<void> => {
  await apiv3Post('/pages/resume-rename', { pageId });
};

export type UpdateStateAfterSaveOption = {
  supressEditingMarkdownMutation: boolean,
}

export const useUpdateStateAfterSave = (pageId: string|undefined|null, opts?: UpdateStateAfterSaveOption): (() => Promise<void>) | undefined => {
  const { mutate: mutateCurrentPageId } = useCurrentPageId();
  const { trigger: mutateCurrentPage } = useSWRMUTxCurrentPage();
  const { setRemoteLatestPageData } = useSetRemoteLatestPageData();
  const { mutate: mutateTagsInfo } = useSWRxTagsInfo(pageId);
  const { sync: syncTagsInfoForEditor } = usePageTagsForEditors(pageId);
  const { mutate: mutateEditingMarkdown } = useEditingMarkdown();
  const { data: isGuestUser } = useIsGuestUser();
  const { mutate: mutateCurrentGrantData } = useSWRxCurrentGrantData(isGuestUser ? null : pageId);
  const { mutate: mutateApplicableGrant } = useSWRxApplicableGrant(isGuestUser ? null : pageId);

  // update swr 'currentPageId', 'currentPage', remote states
  return useCallback(async() => {
    if (pageId == null) { return }

    // update tag before page: https://github.com/growilabs/growi/pull/7158
    // !! DO NOT CHANGE THE ORDERS OF THE MUTATIONS !! -- 12.26 yuken-t
    await mutateTagsInfo(); // get from DB
    syncTagsInfoForEditor(); // sync global state for client

    await mutateCurrentPageId(pageId);
    const updatedPage = await mutateCurrentPage();

    if (updatedPage == null || updatedPage.revision == null) { return }

    // supress to mutate only when updated from built-in editor
    // and see: https://github.com/growilabs/growi/pull/7118
    const supressEditingMarkdownMutation = opts?.supressEditingMarkdownMutation ?? false;
    if (!supressEditingMarkdownMutation) {
      mutateEditingMarkdown(updatedPage.revision.body);
    }

    mutateCurrentGrantData();
    mutateApplicableGrant();

    const remoterevisionData = {
      remoteRevisionId: updatedPage.revision._id,
      remoteRevisionBody: updatedPage.revision.body,
      remoteRevisionLastUpdateUser: updatedPage.lastUpdateUser,
      remoteRevisionLastUpdatedAt: updatedPage.updatedAt,
    };

    setRemoteLatestPageData(remoterevisionData);
  },
  // eslint-disable-next-line max-len
  [pageId, mutateTagsInfo, syncTagsInfoForEditor, mutateCurrentPageId, mutateCurrentPage, opts?.supressEditingMarkdownMutation, mutateCurrentGrantData, mutateApplicableGrant, setRemoteLatestPageData, mutateEditingMarkdown]);
};

export const unlink = async(path: string): Promise<void> => {
  await apiPost('/pages.unlink', { path });
};


interface PageExistResponse {
  isExist: boolean,
}

export const exist = async(path: string): Promise<PageExistResponse> => {
  const res = await apiv3Get<PageExistResponse>('/page/exist', { path });
  return res.data;
};

interface NonUserRelatedGroupsGrantedResponse {
  isNonUserRelatedGroupsGranted: boolean,
}

export const getIsNonUserRelatedGroupsGranted = async(path: string): Promise<NonUserRelatedGroupsGrantedResponse> => {
  const res = await apiv3Get<NonUserRelatedGroupsGrantedResponse>('/page/non-user-related-groups-granted', { path });
  return res.data;
};

export const publish = async(pageId: string): Promise<IPageHasId> => {
  const res = await apiv3Put(`/page/${pageId}/publish`);
  return res.data;
};

export const unpublish = async(pageId: string): Promise<IPageHasId> => {
  const res = await apiv3Put(`/page/${pageId}/unpublish`);
  return res.data;
};

export const syncLatestRevisionBody = async(pageId: string, editingMarkdownLength?: number): Promise<SyncLatestRevisionBody> => {
  const res = await apiv3Put(`/page/${pageId}/sync-latest-revision-body-to-yjs-draft`, { editingMarkdownLength });
  return res.data;
};
