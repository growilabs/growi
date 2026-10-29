import { useCallback, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { useSWRxCommentList } from '~/features/comment/client/stores/comment-list';
import type { ICommentListItem } from '~/features/comment/interfaces';

import type {
  UpdateCommentReactionRequestBody,
  UpdateCommentReactionResponseBody,
} from '../../dto';
import type { ReactionChip, ReactionKey } from '../../interfaces';
import {
  classifyReactionUpdateFailure,
  type ReactionUpdateFailureKind,
} from '../utils/classify-reaction-update-failure';
import { findReactionsByCommentId } from '../utils/find-reactions-by-comment-id';

const MESSAGE_KEY_BY_FAILURE: Readonly<
  Record<ReactionUpdateFailureKind, string>
> = {
  'kind-limit-exceeded': 'comment_reaction.kind_limit_reached',
  'comment-unavailable': 'comment_reaction.comment_unavailable',
  failed: 'comment_reaction.update_failed',
};

export type UseCommentReactions = {
  /** undefined while loading; null when the reactions could not be loaded. */
  readonly chips: readonly ReactionChip[] | null | undefined;
  readonly isUpdating: boolean;
  /** Never rejects: failures are shown to the user and followed by a refetch of the comment list. */
  readonly setReaction: (
    emoji: ReactionKey,
    isReacted: boolean,
  ) => Promise<void>;
};

export const useCommentReactions = (
  pageId: string,
  commentId: string,
): UseCommentReactions => {
  const { t } = useTranslation();
  const { data: comments, mutate } = useSWRxCommentList(pageId);
  const [isUpdating, setIsUpdating] = useState(false);

  const chips =
    comments == null
      ? undefined
      : findReactionsByCommentId(comments, commentId);

  // SWR keeps the previous data when a refetch fails, so the display then stays as it was.
  const refetchQuietly = useCallback(async (): Promise<void> => {
    try {
      await mutate();
    } catch {
      // intentionally ignored
    }
  }, [mutate]);

  const setReaction = useCallback(
    async (emoji: ReactionKey, isReacted: boolean): Promise<void> => {
      setIsUpdating(true);
      try {
        const body: UpdateCommentReactionRequestBody = { emoji, isReacted };
        let comment: ICommentListItem;
        try {
          const response = await apiv3Put<UpdateCommentReactionResponseBody>(
            `/comments/${commentId}/reactions`,
            body,
          );
          comment = response.data.comment;
        } catch (errors) {
          toastError(
            t(MESSAGE_KEY_BY_FAILURE[classifyReactionUpdateFailure(errors)]),
          );
          await refetchQuietly();
          return;
        }

        if (comment.reactions == null) {
          await refetchQuietly();
          return;
        }

        await mutate(
          (current?: ICommentListItem[]) =>
            current?.map((item) => (item.id === commentId ? comment : item)),
          { revalidate: false },
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [commentId, mutate, refetchQuietly, t],
  );

  return { chips, isUpdating, setReaction };
};
