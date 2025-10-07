
import React, { useState, type JSX } from 'react';

import type { IUser } from '@growi/core';
import { useAtomValue } from 'jotai';
import { Collapse } from 'reactstrap';

import type { ICommentHasId, ICommentHasIdList } from '~/interfaces/comment';
import type { RendererOptions } from '~/interfaces/renderer-options';
import { isAllReplyShownAtom } from '~/states/server-configurations';


import { Comment } from './Comment';

import styles from './ReplyComments.module.scss';


type ReplycommentsProps = {
  rendererOptions: RendererOptions,
  isReadOnly: boolean,
  revisionId: string,
  revisionCreatedAt: Date,
  currentUser: IUser,
  replyList: ICommentHasIdList,
  pageId: string,
  pagePath: string,
  deleteBtnClicked: (comment: ICommentHasId) => void,
  onComment: () => void,
}

export const ReplyComments = (props: ReplycommentsProps): JSX.Element => {

  const {
    rendererOptions, isReadOnly, revisionId, revisionCreatedAt, currentUser, replyList,
    pageId, pagePath, deleteBtnClicked, onComment,
  } = props;

  const isAllReplyShown = useAtomValue(isAllReplyShownAtom);

  const [isOlderRepliesShown, setIsOlderRepliesShown] = useState(false);

  const renderReply = (reply: ICommentHasId) => {
    return (
      <div key={reply._id} className={`${styles['page-comment-reply']} mt-2 ms-4 ms-sm-5`}>
        <Comment
          rendererOptions={rendererOptions}
          comment={reply}
          revisionId={revisionId}
          revisionCreatedAt={revisionCreatedAt}
          currentUser={currentUser}
          isReadOnly={isReadOnly}
          pageId={pageId}
          pagePath={pagePath}
          deleteBtnClicked={deleteBtnClicked}
          onComment={onComment}
        />
      </div>
    );
  };

  if (isAllReplyShown) {
    return (
      <>
        {replyList.map((reply) => {
          return renderReply(reply);
        })}
      </>
    );
  }

  const areThereHiddenReplies = (replyList.length > 2);
  const toggleButtonIconName = isOlderRepliesShown ? 'expand_less' : 'more_vert';
  const toggleButtonIcon = <span className="material-symbols-outlined me-1">{toggleButtonIconName}</span>;
  const toggleButtonLabel = isOlderRepliesShown ? '' : 'more';
  const shownReplies = replyList.slice(replyList.length - 2, replyList.length);
  const hiddenReplies = replyList.slice(0, replyList.length - 2);

  const hiddenElements = hiddenReplies.map((reply) => {
    return renderReply(reply);
  });

  const shownElements = shownReplies.map((reply) => {
    return renderReply(reply);
  });

  return (
    <>
      {areThereHiddenReplies && (
        <div className={`${styles['page-comments-hidden-replies']}`}>
          <Collapse isOpen={isOlderRepliesShown}>
            <div>{hiddenElements}</div>
          </Collapse>
          <div className="text-center">
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setIsOlderRepliesShown(!isOlderRepliesShown)}
            >
              {toggleButtonIcon} {toggleButtonLabel}
            </button>
          </div>
        </div>
      )}
      {shownElements}
    </>
  );
};
