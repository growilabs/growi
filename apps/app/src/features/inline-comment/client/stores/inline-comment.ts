/**
 * SWR store for the inline-comment feature (design.md's File Structure Plan:
 * `client/stores/inline-comment.ts`, "SWRフック（一覧取得・起点作成・返信作成・
 * 解決トグルのmutate）").
 *
 * Follows the established `useSWRx*` + `withUtils` pattern (see
 * `features/external-user-group/client/stores/external-user-group.ts`): the
 * list hook owns the SWR key, and each write helper (`create`/`createReply`/
 * `resolve`) posts/puts through `apiv3Post`/`apiv3Put` and then calls the
 * bound `mutate()` from the SAME `useSWR` call, so a write always revalidates
 * the exact list the caller is looking at rather than a globally-keyed one.
 *
 * The SWR key is `['/inline-comments', pageId]` (an array key, not the bare
 * endpoint string) so that different pages never share a cache entry.
 */

import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import useSWR from 'swr';

import { apiv3Get, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';

import type { InlineCommentWithReplies } from '../../interfaces';
import type {
  CreateInlineCommentReplyRequestBody,
  CreateInlineCommentReplyResponseBody,
  CreateInlineCommentRequestBody,
  CreateInlineCommentResponseBody,
  ListInlineCommentsResponseBody,
  ResolveInlineCommentResponseBody,
} from '../../interfaces/dto';

type InlineCommentListUtils = {
  /** POST /_api/v3/inline-comments, then revalidate this page's list. */
  create(
    body: CreateInlineCommentRequestBody,
  ): Promise<CreateInlineCommentResponseBody['inlineComment']>;
  /**
   * POST /_api/v3/inline-comments/:parentId/replies, then revalidate this
   * page's list.
   */
  createReply(
    parentId: string,
    body: CreateInlineCommentReplyRequestBody,
  ): Promise<CreateInlineCommentReplyResponseBody['inlineCommentReply']>;
  /**
   * PUT /_api/v3/inline-comments/:id/resolve, then revalidate this page's
   * list.
   */
  resolve(
    id: string,
    resolved: boolean,
  ): Promise<ResolveInlineCommentResponseBody['inlineComment']>;
};

/**
 * Fetches the page-scoped inline-comment list (origin comments with nested
 * replies, creation-order — sorted server-side by `listByPageId`) and
 * exposes `create`/`createReply`/`resolve` helpers that revalidate it.
 *
 * Pass `null` while the page id is not yet known — SWR will not fetch, same
 * convention as the rest of the codebase's `useSWRx*` hooks (see
 * `useSWRxExternalUserGroup`).
 */
export const useSWRxInlineComments = (
  pageId: string | null,
): SWRResponseWithUtils<
  InlineCommentListUtils,
  InlineCommentWithReplies[],
  Error
> => {
  const swrResponse = useSWR(
    pageId != null ? (['/inline-comments', pageId] as const) : null,
    ([endpoint, pageId]) =>
      apiv3Get<ListInlineCommentsResponseBody>(endpoint, { pageId }).then(
        (response) => response.data.inlineComments,
      ),
  );

  const create: InlineCommentListUtils['create'] = async (body) => {
    const response = await apiv3Post<CreateInlineCommentResponseBody>(
      '/inline-comments',
      body,
    );
    await swrResponse.mutate();
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
    await swrResponse.mutate();
    return response.data.inlineCommentReply;
  };

  const resolve: InlineCommentListUtils['resolve'] = async (id, resolved) => {
    const response = await apiv3Put<ResolveInlineCommentResponseBody>(
      `/inline-comments/${id}/resolve`,
      { resolved },
    );
    await swrResponse.mutate();
    return response.data.inlineComment;
  };

  return withUtils(swrResponse, { create, createReply, resolve });
};
