import { useCallback, useMemo } from 'react';
import type { Nullable } from '@growi/core';
import type { SWRResponse } from 'swr';

import { apiPost } from '~/client/util/apiv1-client';
import { useSWRxCommentList } from '~/features/comment/client/stores/comment-list';

import type {
  ICommentHasIdList,
  ICommentPostArgs,
} from '../interfaces/comment';

type CommentOperation = {
  update(comment: string, revisionId: string, commentId: string): Promise<void>;
  post(args: ICommentPostArgs): Promise<void>;
};

export const useSWRxPageComment = (
  pageId: Nullable<string>,
): SWRResponse<ICommentHasIdList, Error> & CommentOperation => {
  const swrResponse = useSWRxCommentList(pageId);

  const { data: commentList, mutate } = swrResponse;

  // Excluding inline rows here is also what keeps them off the share-link
  // view and the search-result preview, which render only this list.
  const normalComments = useMemo(
    () => commentList?.filter((comment) => !comment.isInline),
    [commentList],
  );

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
    data: normalComments,
    update,
    post,
  };
};
