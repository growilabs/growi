import React, { useMemo } from 'react';

import { isPopulated } from '@growi/core';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';
import {
  Button, Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { Username } from '../../../components/User/Username';
import type { ICommentHasId } from '../../../interfaces/comment';

import styles from './DeleteCommentModal.module.scss';


export type DeleteCommentModalProps = {
  isShown: boolean,
  comment: ICommentHasId | null,
  errorMessage: string,
  cancelToDelete: () => void,
  confirmToDelete: () => void,
}

/**
 * DeleteCommentModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
type DeleteCommentModalSubstanceProps = {
  comment: ICommentHasId,
  errorMessage: string,
  cancelToDelete: () => void,
  confirmToDelete: () => void,
}

const DeleteCommentModalSubstance = (props: DeleteCommentModalSubstanceProps): React.JSX.Element => {
  const {
    comment, errorMessage, cancelToDelete, confirmToDelete,
  } = props;

  const { t } = useTranslation();

  // Memoize formatted date
  const commentDate = useMemo(() => {
    if (comment == null) return '';
    return format(new Date(comment.createdAt), 'yyyy/MM/dd HH:mm');
  }, [comment]);

  // Memoize creator
  const creator = useMemo(() => {
    if (comment == null) return undefined;
    return isPopulated(comment.creator) ? comment.creator : undefined;
  }, [comment]);

  // Memoize processed comment body
  const commentBodyElement = useMemo(() => {
    if (comment == null) return null;
    const OMIT_BODY_THRES = 400;
    let commentBody = comment.comment;
    if (commentBody.length > OMIT_BODY_THRES) {
      commentBody = `${commentBody.substr(0, OMIT_BODY_THRES)}...`;
    }
    return <span style={{ whiteSpace: 'pre-wrap' }}>{commentBody}</span>;
  }, [comment]);

  // Memoize header content
  const headerContent = useMemo(() => (
    <span>
      <span className="material-symbols-outlined">delete_forever</span>
      {t('page_comment.delete_comment')}
    </span>
  ), [t]);

  // Memoize body content
  const bodyContent = useMemo(() => (
    <>
      <UserPicture user={creator} size="xs" /> <strong className="me-2"><Username user={creator}></Username></strong>{commentDate}:
      <div className="card mt-2">
        <div className="card-body comment-body px-3 py-2">{commentBodyElement}</div>
      </div>
    </>
  ), [creator, commentDate, commentBodyElement]);

  // Memoize footer content
  const footerContent = useMemo(() => (
    <>
      <span className="text-danger">{errorMessage}</span>&nbsp;
      <Button onClick={cancelToDelete}>{t('Cancel')}</Button>
      <Button data-testid="delete-comment-button" color="danger" onClick={confirmToDelete}>
        <span className="material-symbols-outlined">delete_forever</span>
        {t('Delete')}
      </Button>
    </>
  ), [errorMessage, cancelToDelete, confirmToDelete, t]);

  return (
    <>
      <ModalHeader tag="h4" toggle={cancelToDelete} className="text-danger">
        {headerContent}
      </ModalHeader>
      <ModalBody>
        {bodyContent}
      </ModalBody>
      <ModalFooter>
        {footerContent}
      </ModalFooter>
    </>
  );
};

/**
 * DeleteCommentModal - Container component (lightweight, always rendered)
 */
export const DeleteCommentModal = (props: DeleteCommentModalProps): React.JSX.Element => {
  const {
    isShown, comment, errorMessage, cancelToDelete, confirmToDelete,
  } = props;

  return (
    <Modal data-testid="page-comment-delete-modal" isOpen={isShown} toggle={cancelToDelete} className={`${styles['page-comment-delete-modal']}`}>
      {isShown && comment != null && (
        <DeleteCommentModalSubstance
          comment={comment}
          errorMessage={errorMessage}
          cancelToDelete={cancelToDelete}
          confirmToDelete={confirmToDelete}
        />
      )}
    </Modal>
  );
};
