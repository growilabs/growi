import { type JSX, useEffect, useMemo, useState } from 'react';
import { type IUser, isPopulated } from '@growi/core';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { UncontrolledTooltip } from 'reactstrap';

import type { RendererOptions } from '~/interfaces/renderer-options';

import RevisionRenderer from '../../../components/PageView/RevisionRenderer';
import type { ICommentHasId } from '../../../interfaces/comment';
import { CommentCard } from './CommentCard';
import { CommentControl } from './CommentControl';
import { CommentEditor } from './CommentEditor';
import { CommentRevisionLink } from './CommentRevisionLink';
import { DeleteConfirmAlert } from './DeleteConfirmAlert';

import styles from './Comment.module.scss';

type CommentProps = {
  comment: ICommentHasId;
  rendererOptions: RendererOptions;
  revisionId: string;
  revisionCreatedAt: Date;
  currentUser: IUser;
  isReadOnly: boolean;
  pageId: string;
  pagePath: string;
  /**
   * Deletes this comment, called once the reader has confirmed it in the
   * inline confirmation below. The request and the list revalidation belong
   * to the parent; a rejection is reported in place by this component.
   */
  onDeleteConfirmed: (comment: ICommentHasId) => Promise<void>;
  onComment: () => void;
};

export const Comment = (props: CommentProps): JSX.Element => {
  const {
    comment,
    rendererOptions,
    revisionId,
    revisionCreatedAt,
    currentUser,
    isReadOnly,
    pageId,
    pagePath,
    onDeleteConfirmed,
    onComment,
  } = props;

  const [markdown, setMarkdown] = useState('');
  const [isReEdit, setIsReEdit] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const commentId = comment._id;
  const creator = isPopulated(comment.creator) ? comment.creator : undefined;
  const createdAt = new Date(comment.createdAt);
  const updatedAt = new Date(comment.updatedAt);
  const isEdited = createdAt < updatedAt;

  useEffect(() => {
    if (revisionId == null) {
      return;
    }

    setMarkdown(comment.comment);

    const isCurrentRevision = () => {
      return comment.revision === revisionId;
    };
    isCurrentRevision();
  }, [comment, revisionId]);

  const isCurrentUserEqualsToAuthor = () => {
    const { creator }: any = comment;
    if (creator == null || currentUser == null) {
      return false;
    }
    return creator.username === currentUser.username;
  };

  /**
   * Only the modifier classes for `.page-comment`. `CommentCard` supplies the
   * `page-comment flex-column` prefix itself, so this must not repeat it.
   * Returns undefined when there is no modifier, to avoid a trailing space in
   * the emitted class attribute.
   */
  const getRootClassName = (comment: ICommentHasId): string | undefined => {
    const modifiers: string[] = [];

    // TODO: fix so that `comment.createdAt` to be type Date https://redmine.weseek.co.jp/issues/113876
    const commentCreatedAtFixed =
      typeof comment.createdAt === 'string'
        ? parseISO(comment.createdAt)
        : comment.createdAt;
    const revisionCreatedAtFixed =
      typeof revisionCreatedAt === 'string'
        ? parseISO(revisionCreatedAt)
        : revisionCreatedAt;

    // Conditional for called from SearchResultContext
    if (revisionId != null && revisionCreatedAt != null) {
      if (comment.revision === revisionId) {
        modifiers.push('page-comment-current');
      } else if (
        commentCreatedAtFixed.getTime() > revisionCreatedAtFixed.getTime()
      ) {
        modifiers.push('page-comment-newer');
      } else {
        modifiers.push('page-comment-older');
      }
    }

    if (isCurrentUserEqualsToAuthor()) {
      modifiers.push('page-comment-me');
    }

    return modifiers.length > 0 ? modifiers.join(' ') : undefined;
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    try {
      await onDeleteConfirmed(comment);
      setDeleteError(undefined);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when deleting the comment',
      );
    } finally {
      setIsDeleteConfirmOpen(false);
    }
  };

  const commentBody = useMemo(() => {
    if (rendererOptions == null) {
      return <></>;
    }

    return (
      <RevisionRenderer
        rendererOptions={rendererOptions}
        markdown={markdown}
        additionalClassName="comment"
      />
    );
  }, [markdown, rendererOptions]);

  const rootClassName = getRootClassName(comment);
  const editedDateId = `editedDate-${comment._id}`;
  const editedDateFormatted = isEdited
    ? format(updatedAt, 'yyyy/MM/dd HH:mm')
    : null;

  return (
    <div className={`${styles['comment-styles']}`}>
      {isReEdit && !isReadOnly ? (
        <CommentEditor
          pageId={comment._id}
          replyTo={undefined}
          currentCommentId={commentId}
          commentBody={comment.comment}
          onCanceled={() => setIsReEdit(false)}
          onCommented={() => {
            setIsReEdit(false);
            onComment();
          }}
          revisionId={revisionId}
        />
      ) : (
        <CommentCard
          id={commentId}
          creator={creator}
          createdAt={comment.createdAt}
          rootClassName={rootClassName}
          headerEnd={
            <>
              <span className={`ms-2 ${styles['icon-button-container']}`}>
                <CommentRevisionLink
                  id={commentId}
                  pagePath={pagePath}
                  pageId={pageId}
                  // `comment.revision` is typed `Ref<IRevision>` (populated
                  // or not), but this control only ever needs its id -- the
                  // same implicit stringification the pre-extraction inline
                  // markup relied on via template-literal interpolation.
                  revisionId={String(comment.revision)}
                />
              </span>
              {/* In the header row's own flex flow (`ms-auto`), not
                  `position: absolute` -- absolute ignored
                  `.page-comment-main`'s padding, sitting flush against the
                  border unlike every other header item. Kept out of the
                  revision link's `ms-2` span, which must stay next to the
                  date. */}
              {isCurrentUserEqualsToAuthor() &&
                !isReadOnly &&
                !isDeleteConfirmOpen && (
                  <span className="ms-auto">
                    <CommentControl
                      onClickDeleteBtn={() => setIsDeleteConfirmOpen(true)}
                      onClickEditBtn={() => setIsReEdit(true)}
                    />
                  </span>
                )}
            </>
          }
          footer={
            <>
              <div className="page-comment-meta">
                {isEdited && (
                  <>
                    <span id={editedDateId}>&nbsp;(edited)</span>
                    <UncontrolledTooltip
                      placement="bottom"
                      fade={false}
                      target={editedDateId}
                    >
                      {editedDateFormatted}
                    </UncontrolledTooltip>
                  </>
                )}
              </div>
              {deleteError != null && (
                <span
                  className="text-danger d-block"
                  data-testid="comment-delete-error"
                >
                  {deleteError}
                </span>
              )}
              {isDeleteConfirmOpen && (
                <DeleteConfirmAlert
                  testIdPrefix="comment"
                  onCancel={() => setIsDeleteConfirmOpen(false)}
                  onConfirm={handleDeleteConfirm}
                />
              )}
            </>
          }
        >
          {commentBody}
        </CommentCard>
      )}
    </div>
  );
};
