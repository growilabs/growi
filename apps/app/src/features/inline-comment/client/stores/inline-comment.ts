/**
 * SWR store for the inline-comment feature.
 *
 * The list is not fetched here: it is derived from the page's shared comment
 * list (`useSWRxCommentList`), so the body highlights and the bottom comment
 * thread read one cache entry and one request. Every write helper refetches
 * that shared list; writes that change the page's comment count also refetch
 * the page info, as ordinary comment writes do.
 */

import { useCallback, useMemo } from 'react';
import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import type { KeyedMutator, SWRResponse } from 'swr';

import { apiv3Delete, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';
import { useSWRxCommentList } from '~/features/comment/client/stores/comment-list';
import { useSWRMUTxPageInfo } from '~/stores/page';

import type { InlineCommentWithReplies } from '../../interfaces';
import type {
  CreateInlineCommentReplyRequestBody,
  CreateInlineCommentReplyResponseBody,
  CreateInlineCommentRequestBody,
  CreateInlineCommentResponseBody,
  ResolveInlineCommentResponseBody,
  UpdateInlineCommentReplyResponseBody,
  UpdateInlineCommentResponseBody,
} from '../../interfaces/dto';
import { groupInlineComments } from '../services/group-inline-comments';

type InlineCommentListUtils = {
  /** POST /_api/v3/inline-comments, then refetch the list and page info. */
  create(
    body: CreateInlineCommentRequestBody,
  ): Promise<CreateInlineCommentResponseBody['inlineComment']>;
  /**
   * POST /_api/v3/inline-comments/:parentId/replies, then refetch the list
   * and page info.
   */
  createReply(
    parentId: string,
    body: CreateInlineCommentReplyRequestBody,
  ): Promise<CreateInlineCommentReplyResponseBody['inlineCommentReply']>;
  /** PUT /_api/v3/inline-comments/:id/resolve, then refetch the list. */
  resolve(
    id: string,
    resolved: boolean,
  ): Promise<ResolveInlineCommentResponseBody['inlineComment']>;
  /** PUT /_api/v3/inline-comments/:id, then refetch the list. */
  update(
    id: string,
    comment: string,
  ): Promise<UpdateInlineCommentResponseBody['inlineComment']>;
  /** PUT /_api/v3/inline-comments/replies/:id, then refetch the list. */
  updateReply(
    id: string,
    comment: string,
  ): Promise<UpdateInlineCommentReplyResponseBody['inlineCommentReply']>;
  /** DELETE /_api/v3/inline-comments/:id, then refetch the list and page info. */
  remove(id: string): Promise<Record<string, never>>;
  /**
   * DELETE /_api/v3/inline-comments/replies/:id, then refetch the list and
   * page info.
   */
  removeReply(id: string): Promise<Record<string, never>>;
};

/**
 * Returns the page's inline comments as origins with nested replies (newest
 * first, the order the shared list arrives in) and write helpers that keep it
 * fresh.
 *
 * Pass `null` while the page id is not yet known, or on views that must not
 * show inline comments (the share-link view) — nothing is fetched then.
 */
export const useSWRxInlineComments = (
  pageId: string | null,
): SWRResponseWithUtils<
  InlineCommentListUtils,
  InlineCommentWithReplies[],
  Error
> => {
  const commentList = useSWRxCommentList(pageId);
  const { trigger: triggerPageInfo } = useSWRMUTxPageInfo(pageId);

  const { data: commentListData, mutate: mutateCommentList } = commentList;

  const data = useMemo(
    () =>
      commentListData != null
        ? groupInlineComments(commentListData)
        : undefined,
    [commentListData],
  );

  // Revalidation only: the grouped list is derived, so it cannot be written
  // back into the shared cache. No caller passes data to `mutate`.
  const mutate: KeyedMutator<InlineCommentWithReplies[]> =
    useCallback(async () => {
      const refreshed = await mutateCommentList();
      return refreshed != null ? groupInlineComments(refreshed) : undefined;
    }, [mutateCommentList]);

  // The write has already succeeded; a failed page-info refetch must not
  // surface as a failed write.
  const refetchListAndPageInfo = async (): Promise<void> => {
    await Promise.all([
      mutateCommentList(),
      triggerPageInfo(null, { throwOnError: false }),
    ]);
  };

  // Getters keep SWR's per-field subscription: a caller that never reads
  // isValidating must not re-render on every revalidation.
  const swrResponse: SWRResponse<InlineCommentWithReplies[], Error> = {
    data,
    get error() {
      return commentList.error;
    },
    get isLoading() {
      return commentList.isLoading;
    },
    get isValidating() {
      return commentList.isValidating;
    },
    mutate,
  };

  const create: InlineCommentListUtils['create'] = async (body) => {
    const response = await apiv3Post<CreateInlineCommentResponseBody>(
      '/inline-comments',
      body,
    );
    await refetchListAndPageInfo();
    return response.data.inlineComment;
  };

  const createReply: InlineCommentListUtils['createReply'] = async (
    parentId,
    body,
  ) => {
    const response = await apiv3Post<CreateInlineCommentReplyResponseBody>(
      `/inline-comments/${parentId}/replies`,
      body,
    );
    await refetchListAndPageInfo();
    return response.data.inlineCommentReply;
  };

  const resolve: InlineCommentListUtils['resolve'] = async (id, resolved) => {
    const response = await apiv3Put<ResolveInlineCommentResponseBody>(
      `/inline-comments/${id}/resolve`,
      { resolved },
    );
    await mutateCommentList();
    return response.data.inlineComment;
  };

  const update: InlineCommentListUtils['update'] = async (id, comment) => {
    const response = await apiv3Put<UpdateInlineCommentResponseBody>(
      `/inline-comments/${id}`,
      { comment },
    );
    await mutateCommentList();
    return response.data.inlineComment;
  };

  const updateReply: InlineCommentListUtils['updateReply'] = async (
    id,
    comment,
  ) => {
    const response = await apiv3Put<UpdateInlineCommentReplyResponseBody>(
      `/inline-comments/replies/${id}`,
      { comment },
    );
    await mutateCommentList();
    return response.data.inlineCommentReply;
  };

  const remove: InlineCommentListUtils['remove'] = async (id) => {
    const response = await apiv3Delete(`/inline-comments/${id}`);
    await refetchListAndPageInfo();
    return response.data;
  };

  const removeReply: InlineCommentListUtils['removeReply'] = async (id) => {
    const response = await apiv3Delete(`/inline-comments/replies/${id}`);
    await refetchListAndPageInfo();
    return response.data;
  };

  return withUtils(swrResponse, {
    create,
    createReply,
    resolve,
    update,
    updateReply,
    remove,
    removeReply,
  });
};
