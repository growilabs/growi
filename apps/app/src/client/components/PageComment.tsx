import type { FC, JSX } from 'react';
import React, {
  useState, useMemo, memo, useCallback,
} from 'react';

import type { IRevision, Ref } from '@growi/core';
import {
  isPopulated, getIdStringForRef,
} from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { apiPost } from '~/client/util/apiv1-client';
import { toastError } from '~/client/util/toastr';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { useSWRMUTxPageInfo } from '~/stores/page';
import { useCommentForCurrentPageOptions } from '~/stores/renderer';

import type { ICommentHasId, ICommentHasIdList } from '../../interfaces/comment';
import { useSWRxPageComment } from '../../stores/comment';

import { NotAvailableForGuest } from './NotAvailableForGuest';
import { NotAvailableIfReadOnlyUserNotAllowedToComment } from './NotAvailableForReadOnlyUser';
import { Comment } from './PageComment/Comment';
import { CommentEditor } from './PageComment/CommentEditor';
import { DeleteCommentModalLazyLoaded } from './PageComment/DeleteCommentModal';
import { ReplyComments } from './PageComment/ReplyComments';

import styles from './PageComment.module.scss';


type PageCommentProps = {
  rendererOptions?: RendererOptions,
  pageId: string,
  pagePath: string,
  revision: Ref<IRevision>,
  currentUser: any,
  isReadOnly: boolean,
}

export const PageComment: FC<PageCommentProps> = memo((props: PageCommentProps): JSX.Element => {

  const {
    rendererOptions: rendererOptionsByProps,
    pageId, pagePath, revision, currentUser, isReadOnly,
  } = props;

  const { data: comments, mutate } = useSWRxPageComment(pageId);
  const { data: rendererOptionsForCurrentPage } = useCommentForCurrentPageOptions();

  const [commentToBeDeleted, setCommentToBeDeleted] = useState<ICommentHasId | null>(null);
  const [isDeleteConfirmModalShown, setIsDeleteConfirmModalShown] = useState<boolean>(false);
  const [showEditorIds, setShowEditorIds] = useState<Set<string>>(new Set());
  const [errorMessageOnDelete, setErrorMessageOnDelete] = useState<string>('');
  const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(pageId);

  const { t } = useTranslation('');

  const commentsFromOldest = useMemo(() => (comments != null ? [...comments].reverse() : null), [comments]);
  const commentsExceptReply: ICommentHasIdList | undefined = useMemo(
    () => commentsFromOldest?.filter(comment => comment.replyTo == null), [commentsFromOldest],
  );
  const allReplies = {};

  if (commentsFromOldest != null) {
    commentsFromOldest.forEach((comment) => {
      if (comment.replyTo != null) {
        allReplies[comment.replyTo] = allReplies[comment.replyTo] == null ? [comment] : [...allReplies[comment.replyTo], comment];
      }
    });
  }

  const onClickDeleteButton = useCallback((comment: ICommentHasId) => {
    setCommentToBeDeleted(comment);
    setIsDeleteConfirmModalShown(true);
  }, []);

  const onCancelDeleteComment = useCallback(() => {
    setCommentToBeDeleted(null);
    setIsDeleteConfirmModalShown(false);
  }, []);

  const onDeleteCommentAfterOperation = useCallback(() => {
    onCancelDeleteComment();
    mutate();
    mutatePageInfo();
  }, [mutate, onCancelDeleteComment, mutatePageInfo]);

  const onDeleteComment = useCallback(async() => {
    if (commentToBeDeleted == null) return;
    try {
      await apiPost('/comments.remove', { comment_id: commentToBeDeleted._id });
      onDeleteCommentAfterOperation();
    }
    catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : (error as any).toString();

      setErrorMessageOnDelete(message);
      toastError(message);
    }
  }, [commentToBeDeleted, onDeleteCommentAfterOperation]);

  const removeShowEditorId = useCallback((commentId: string) => {
    setShowEditorIds((previousState) => {
      return new Set([...previousState].filter(id => id !== commentId));
    });
  }, []);

  const onReplyButtonClickHandler = useCallback((commentId: string) => {
    setShowEditorIds(previousState => new Set([...previousState, commentId]));
  }, []);

  const onCommentButtonClickHandler = useCallback((commentId: string) => {
    removeShowEditorId(commentId);
    mutate();
    mutatePageInfo();
  }, [removeShowEditorId, mutate, mutatePageInfo]);

  if (comments?.length === 0) {
    return <></>;
  }

  const rendererOptions = rendererOptionsByProps ?? rendererOptionsForCurrentPage;

  if (commentsFromOldest == null || commentsExceptReply == null || rendererOptions == null) {
    return <></>;
  }

  const revisionId = getIdStringForRef(revision);
  const revisionCreatedAt = (isPopulated(revision)) ? revision.createdAt : undefined;

  const commentElement = (comment: ICommentHasId) => (
    <Comment
      rendererOptions={rendererOptions}
      comment={comment}
      revisionId={revisionId}
      revisionCreatedAt={revisionCreatedAt as Date}
      currentUser={currentUser}
      isReadOnly={isReadOnly}
      pageId={pageId}
      pagePath={pagePath}
      deleteBtnClicked={onClickDeleteButton}
      onComment={mutate}
    />
  );

  const replyCommentsElement = (replyComments: ICommentHasIdList) => (
    <ReplyComments
      rendererOptions={rendererOptions}
      isReadOnly={isReadOnly}
      revisionId={revisionId}
      revisionCreatedAt={revisionCreatedAt as Date}
      currentUser={currentUser}
      replyList={replyComments}
      pageId={pageId}
      pagePath={pagePath}
      deleteBtnClicked={onClickDeleteButton}
      onComment={mutate}
    />
  );

  return (
    <div className={`${styles['page-comment-styles']} page-comments-row comment-list`}>
      <div className="page-comments">
        <div className="page-comments-list mb-3" id="page-comments-list">
          {commentsExceptReply.map((comment) => {

            const defaultCommentThreadClasses = 'page-comment-thread mb-2';
            const hasReply: boolean = Object.keys(allReplies).includes(comment._id);

            let commentThreadClasses = '';
            commentThreadClasses = hasReply ? `${defaultCommentThreadClasses} page-comment-thread-no-replies` : defaultCommentThreadClasses;

            return (
              <div key={comment._id} className={commentThreadClasses}>
                {/* Comment */}
                {commentElement(comment)}
                {/* Reply comments */}
                {hasReply && replyCommentsElement(allReplies[comment._id])}

                {(!isReadOnly && !showEditorIds.has(comment._id)) && (
                  <div className="d-flex flex-row-reverse">
                    <NotAvailableForGuest>
                      <NotAvailableIfReadOnlyUserNotAllowedToComment>
                        <button
                          type="button"
                          data-testid="comment-reply-button"
                          className="btn btn-secondary btn-comment-reply text-start w-100 ms-5"
                          onClick={() => onReplyButtonClickHandler(comment._id)}
                        >
                          <UserPicture user={currentUser} noLink noTooltip className="me-2" />
                          <span className="material-symbols-outlined me-1 fs-5 pb-1">reply</span><small>{t('page_comment.reply')}...</small>
                        </button>
                      </NotAvailableIfReadOnlyUserNotAllowedToComment>
                    </NotAvailableForGuest>
                  </div>
                )}

                {/* Editor to reply */}
                {(!isReadOnly && showEditorIds.has(comment._id)) && (
                  <CommentEditor
                    pageId={pageId}
                    replyTo={comment._id}
                    onCanceled={() => {
                      removeShowEditorId(comment._id);
                    }}
                    onCommented={() => onCommentButtonClickHandler(comment._id)}
                    revisionId={revisionId}
                  />
                )}
              </div>
            );

          })}
        </div>
      </div>

      {!isReadOnly && (
        <DeleteCommentModalLazyLoaded
          isShown={isDeleteConfirmModalShown}
          comment={commentToBeDeleted}
          errorMessage={errorMessageOnDelete}
          cancelToDelete={onCancelDeleteComment}
          confirmToDelete={onDeleteComment}
        />
      )}
    </div>
  );
});

PageComment.displayName = 'PageComment';
