import { type JSX, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { type IUser, isPopulated } from '@growi/core';
import * as pathUtils from '@growi/core/dist/utils/path-utils';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';
import urljoin from 'url-join';

import type { RendererOptions } from '~/interfaces/renderer-options';

import RevisionRenderer from '../../../components/PageView/RevisionRenderer';
import { Username } from '../../../components/User/Username';
import type { ICommentHasId } from '../../../interfaces/comment';
import FormattedDistanceDate from '../FormattedDistanceDate';
import { CommentControl } from './CommentControl';
import { CommentEditor } from './CommentEditor';

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
  deleteBtnClicked: (comment: ICommentHasId) => void;
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
    deleteBtnClicked,
    onComment,
  } = props;

  const { returnPathForURL } = pathUtils;

  const { t } = useTranslation();

  const [markdown, setMarkdown] = useState('');
  const [isReEdit, setIsReEdit] = useState(false);

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

  const getRootClassName = (comment: ICommentHasId) => {
    let className = 'page-comment flex-column';

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
        className += ' page-comment-current';
      } else if (
        commentCreatedAtFixed.getTime() > revisionCreatedAtFixed.getTime()
      ) {
        className += ' page-comment-newer';
      } else {
        className += ' page-comment-older';
      }
    }

    if (isCurrentUserEqualsToAuthor()) {
      className += ' page-comment-me';
    }

    return className;
  };

  const deleteBtnClickedHandler = () => {
    deleteBtnClicked(comment);
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
  const revHref = `?revisionId=${comment.revision}`;
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
        <div id={commentId} className={rootClassName}>
          <div className="page-comment-main bg-comment rounded mb-2">
            <div className="d-flex align-items-center">
              <UserPicture user={creator} className="me-2" />
              <div className="small fw-bold me-3">
                <Username user={creator} />
              </div>
              <Link
                href={`#${commentId}`}
                prefetch={false}
                className="small page-comment-revision"
              >
                <FormattedDistanceDate
                  id={commentId}
                  date={comment.createdAt}
                />
              </Link>
              <span className="ms-2">
                <Link
                  id={`page-comment-revision-${commentId}`}
                  href={urljoin(returnPathForURL(pagePath, pageId), revHref)}
                  className="page-comment-revision"
                  prefetch={false}
                >
                  <span className="material-symbols-outlined">history</span>
                </Link>
                <UncontrolledTooltip
                  placement="bottom"
                  fade={false}
                  target={`page-comment-revision-${commentId}`}
                >
                  {t('page_comment.display_the_page_when_posting_this_comment')}
                </UncontrolledTooltip>
              </span>
            </div>
            <div className="page-comment-body">{commentBody}</div>
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
            {isCurrentUserEqualsToAuthor() && !isReadOnly && (
              <CommentControl
                onClickDeleteBtn={deleteBtnClickedHandler}
                onClickEditBtn={() => setIsReEdit(true)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
