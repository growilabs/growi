import React, { type JSX } from 'react';

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

export const DeleteCommentModal = (props: DeleteCommentModalProps): JSX.Element => {
  const {
    isShown, comment, errorMessage, cancelToDelete, confirmToDelete,
  } = props;

  const { t } = useTranslation();

  const headerContent = () => {
    if (comment == null || isShown === false) {
      return <></>;
    }
    return (
      <span>
        <span className="material-symbols-outlined">delete_forever</span>
        {t('page_comment.delete_comment')}
      </span>
    );
  };

  const bodyContent = () => {
    if (comment == null || isShown === false) {
      return <></>;
    }

    // the threshold for omitting body
    const OMIT_BODY_THRES = 400;

    const commentDate = format(new Date(comment.createdAt), 'yyyy/MM/dd HH:mm');

    const creator = isPopulated(comment.creator) ? comment.creator : undefined;

    let commentBody = comment.comment;
    if (commentBody.length > OMIT_BODY_THRES) { // omit
      commentBody = `${commentBody.substr(0, OMIT_BODY_THRES)}...`;
    }
    const commentBodyElement = <span style={{ whiteSpace: 'pre-wrap' }}>{commentBody}</span>;

    return (
      <>
        <UserPicture user={creator} size="xs" /> <strong className="me-2"><Username user={creator}></Username></strong>{commentDate}:
        <div className="card mt-2">
          <div className="card-body comment-body px-3 py-2">{commentBodyElement}</div>
        </div>
      </>
    );
  };

  const footerContent = () => {
    if (comment == null || isShown === false) {
      return <></>;
    }
    return (
      <>
        <span className="text-danger">{errorMessage}</span>&nbsp;
        <Button onClick={cancelToDelete}>{t('Cancel')}</Button>
        <Button data-testid="delete-comment-button" color="danger" onClick={confirmToDelete}>
          <span className="material-symbols-outlined">delete_forever</span>
          {t('Delete')}
        </Button>
      </>
    );
  };

  return (
    <Modal data-testid="page-comment-delete-modal" isOpen={isShown} toggle={cancelToDelete} className={`${styles['page-comment-delete-modal']}`}>
      <ModalHeader tag="h4" toggle={cancelToDelete} className="text-danger">
        {headerContent()}
      </ModalHeader>
      <ModalBody>
        {bodyContent()}
      </ModalBody>
      <ModalFooter>
        {footerContent()}
      </ModalFooter>
    </Modal>
  );
};
