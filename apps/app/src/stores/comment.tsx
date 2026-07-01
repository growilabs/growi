import { useCallback } from 'react';
import type { Nullable } from '@growi/core';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiGet, apiPost } from '~/client/util/apiv1-client';
import { useShareLinkId } from '~/states/page/hooks';

import type {
  ICommentHasIdList,
  ICommentPostArgs,
} from '../interfaces/comment';

type IResponseComment = {
  comments: ICommentHasIdList;
  ok: boolean;
};

type CommentOperation = {
  update(comment: string, revisionId: string, commentId: string): Promise<void>;
  post(args: ICommentPostArgs): Promise<void>;
};

/**
 * Normalize a raw shareLinkId into a non-empty trimmed string, or `undefined`
 * when it carries no share-link context. Feeding this normalized value into
 * both the SWR cache key and the request keeps them in sync: without it,
 * distinct-but-equivalent raw values (e.g. '  ' vs '   ') would produce
 * separate cache entries that all resolve to the same request.
 */
const normalizeShareLinkId = (
  shareLinkId: string | undefined,
): string | undefined => {
  const trimmed = shareLinkId?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Build query params for /comments.get.
 * Keep the existing `page_id` as the single page identifier (verification and
 * fetch use the same id on the server); add `shareLinkId` only in a share-link
 * context. Never send a separate `pageId` — that would reintroduce the
 * verify/fetch identifier split.
 */
const buildCommentGetParams = (
  pageId: string,
  shareLinkId: string | undefined,
): { page_id: string; shareLinkId?: string } => {
  if (shareLinkId != null) {
    return { page_id: pageId, shareLinkId };
  }
  return { page_id: pageId };
};

export const useSWRxPageComment = (
  pageId: Nullable<string>,
): SWRResponse<ICommentHasIdList, Error> & CommentOperation => {
  const shareLinkId = normalizeShareLinkId(useShareLinkId());

  const shouldFetch: boolean = pageId != null;

  const swrResponse = useSWR(
    shouldFetch ? ['/comments.get', pageId, shareLinkId] : null,
    ([endpoint, pageId, shareLinkId]: [string, string, string | undefined]) =>
      apiGet(endpoint, buildCommentGetParams(pageId, shareLinkId)).then(
        (response: IResponseComment) => response.comments,
      ),
  );

  const { mutate } = swrResponse;

  const update = useCallback(
    async (comment: string, revisionId: string, commentId: string) => {
      await apiPost('/comments.update', {
        commentForm: {
          comment,
          revision_id: revisionId,
          comment_id: commentId,
        },
      });
      mutate();
    },
    [mutate],
  );

  const post = useCallback(
    async (args: ICommentPostArgs) => {
      const { commentForm, slackNotificationForm } = args;
      const { comment, revisionId, replyTo } = commentForm;
      const { isSlackEnabled, slackChannels } = slackNotificationForm;

      await apiPost('/comments.add', {
        commentForm: {
          comment,
          page_id: pageId,
          revision_id: revisionId,
          replyTo,
        },
        slackNotificationForm: {
          isSlackEnabled,
          slackChannels,
        },
      });
      mutate();
    },
    [mutate, pageId],
  );

  return {
    ...swrResponse,
    update,
    post,
  };
};
