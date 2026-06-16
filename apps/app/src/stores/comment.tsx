import { useCallback } from 'react';
import type { Nullable } from '@growi/core';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiGet, apiPost } from '~/client/util/apiv1-client';

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

export const useSWRxPageComment = (
  pageId: Nullable<string>,
): SWRResponse<ICommentHasIdList, Error> & CommentOperation => {
  const shouldFetch: boolean = pageId != null;

  const swrResponse = useSWR(
    shouldFetch ? ['/comments.get', pageId] : null,
    ([endpoint, pageId]) =>
      apiGet(endpoint, { page_id: pageId }).then(
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
