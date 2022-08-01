import React, { useEffect, useState } from 'react';


import { UserPicture } from '@growi/ui';
import { ConsoleFormattedStream } from 'browser-bunyan';
import { format } from 'date-fns';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import { RendererOptions } from '~/services/renderer/renderer';
import { useCurrentUser } from '~/stores/context';

import { ICommentHasId } from '../../interfaces/comment';
import FormattedDistanceDate from '../FormattedDistanceDate';
import HistoryIcon from '../Icons/HistoryIcon';
import RevisionRenderer from '../Page/RevisionRenderer';
import Username from '../User/Username';

import CommentControl from './CommentControl';
import CommentEditor from './CommentEditor';

type CommentProps = {
  comment: ICommentHasId,
  isReadOnly: boolean,
  deleteBtnClicked: (comment: ICommentHasId) => void,
  onComment: () => void,
  rendererOptions: RendererOptions,
  currentPagePath: string,
  currentRevisionId: string,
  currentRevisionCreatedAt: Date,
}

export const Comment = (props: CommentProps): JSX.Element => {
  const {
    comment, isReadOnly, deleteBtnClicked, onComment, rendererOptions, currentPagePath, currentRevisionId, currentRevisionCreatedAt,
  } = props;
  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUser();

  const [markdown, setMarkdown] = useState('');
  const [isReEdit, setIsReEdit] = useState(false);

  const commentId = comment._id;
  const creator = comment.creator;
  const isMarkdown = comment.isMarkdown;
  const createdAt = new Date(comment.createdAt);
  const updatedAt = new Date(comment.updatedAt);
  const isEdited = createdAt < updatedAt;

  useEffect(() => {
    setMarkdown(comment.comment);

    const isCurrentRevision = () => {
      return comment.revision === currentRevisionId;
    };
    isCurrentRevision();

  }, [comment, currentRevisionId]);

  const isCurrentUserEqualsToAuthor = () => {
    const { creator }: any = comment;

    if (creator == null || currentUser == null) {
      return false;
    }
    return creator.username === currentUser.username;
  };

  const getRootClassName = (comment) => {
    let className = 'page-comment flex-column';

    if (comment.revision === currentRevisionId) {
      className += ' page-comment-current';
    }
    else if (comment.createdAt.getTime() > currentRevisionCreatedAt.getTime()) {
      className += ' page-comment-newer';
    }
    else {
      className += ' page-comment-older';
    }

    if (isCurrentUserEqualsToAuthor()) {
      className += ' page-comment-me';
    }

    return className;
  };

  const deleteBtnClickedHandler = (comment) => {
    deleteBtnClicked(comment);
  };

  const renderText = (comment) => {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{comment}</span>;
  };

  // TODO: Remove when update ReplayComments.jsx
  if (currentPagePath == null) {
    return <></>;
  }

  const renderRevisionBody = () => {
    return (
      <RevisionRenderer
        rendererOptions={rendererOptions}
        markdown={markdown}
        additionalClassName="comment"
        pagePath={currentPagePath}
      />
    );
  };

  const rootClassName = getRootClassName(comment);
  const commentBody = isMarkdown ? renderRevisionBody() : renderText(comment.comment);
  const revHref = `?revision=${comment.revision}`;

  const editedDateId = `editedDate-${comment._id}`;
  const editedDateFormatted = isEdited
    ? format(updatedAt, 'yyyy/MM/dd HH:mm')
    : null;

  return (
    <>
      {(isReEdit && !isReadOnly) ? (
        <CommentEditor
          rendererOptions={rendererOptions}
          currentCommentId={commentId}
          commentBody={comment.comment}
          replyTo={undefined}
          commentCreator={creator?.username}
          onCancelButtonClicked={() => setIsReEdit(false)}
          onCommentButtonClicked={() => {
            setIsReEdit(false);
            if (onComment != null) onComment();
          }}
        />
      ) : (
        <div id={commentId} className={rootClassName}>
          <div className="page-comment-writer">
            <UserPicture user={creator} />
          </div>
          <div className="page-comment-main">
            <div className="page-comment-creator">
              <Username user={creator} />
            </div>
            <div className="page-comment-body">{commentBody}</div>
            <div className="page-comment-meta">
              <a href={`#${commentId}`}>
                <FormattedDistanceDate id={commentId} date={comment.createdAt} />
              </a>
              { isEdited && (
                <>
                  <span id={editedDateId}>&nbsp;(edited)</span>
                  <UncontrolledTooltip placement="bottom" fade={false} target={editedDateId}>{editedDateFormatted}</UncontrolledTooltip>
                </>
              )}
              <span className="ml-2">
                <a id={`page-comment-revision-${commentId}`} className="page-comment-revision" href={revHref}>
                  <HistoryIcon />
                </a>
                <UncontrolledTooltip placement="bottom" fade={false} target={`page-comment-revision-${commentId}`}>
                  {t('page_comment.display_the_page_when_posting_this_comment')}
                </UncontrolledTooltip>
              </span>
            </div>
            {(isCurrentUserEqualsToAuthor() && !isReadOnly) && (
              <CommentControl
                onClickDeleteBtn={deleteBtnClickedHandler}
                onClickEditBtn={() => setIsReEdit(true)}
              />
            ) }
          </div>
        </div>
      )
      }
    </>
  );
};
