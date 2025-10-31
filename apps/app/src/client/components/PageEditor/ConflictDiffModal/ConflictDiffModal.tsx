import React, {
  useState, useEffect, useCallback, useMemo,
} from 'react';

import type { IUser } from '@growi/core';
import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { CodeMirrorEditorDiff } from '@growi/editor/dist/client/components/diff/CodeMirrorEditorDiff';
import { MergeViewer } from '@growi/editor/dist/client/components/diff/MergeViewer';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';


import { useCurrentUser } from '~/states/global';
import {
  useCurrentPageData,
  useRemoteRevisionBody,
  useRemoteRevisionLastUpdatedAt,
  useRemoteRevisionLastUpdateUser,
} from '~/states/page';
import { useConflictDiffModalActions, useConflictDiffModalStatus } from '~/states/ui/modal/conflict-diff';

import styles from './ConflictDiffModal.module.scss';

type IRevisionOnConflict = {
  revisionBody: string
  createdAt: Date
  user: IUser
}

/**
 * ConflictDiffModalSubstance - Presentation component (heavy logic, rendered only when isOpen)
 */
type ConflictDiffModalSubstanceProps = {
  request: IRevisionOnConflict
  latest: IRevisionOnConflict
  isModalExpanded: boolean
  setIsModalExpanded: React.Dispatch<React.SetStateAction<boolean>>
};

const formatedDate = (date: Date): string => {
  return format(date, 'yyyy/MM/dd HH:mm:ss');
};

const ConflictDiffModalSubstance = (props: ConflictDiffModalSubstanceProps): React.JSX.Element => {
  const {
    request, latest, isModalExpanded, setIsModalExpanded,
  } = props;

  const [resolvedRevision, setResolvedRevision] = useState<string>('');
  const [isRevisionselected, setIsRevisionSelected] = useState<boolean>(false);
  const [revisionSelectedToggler, setRevisionSelectedToggler] = useState<boolean>(false);

  const { t } = useTranslation();
  const conflictDiffModalStatus = useConflictDiffModalStatus();
  const { close: closeConflictDiffModal } = useConflictDiffModalActions();
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.DIFF);

  // Memoize formatted dates
  const requestFormattedDate = useMemo(() => formatedDate(request.createdAt), [request.createdAt]);
  const latestFormattedDate = useMemo(() => formatedDate(latest.createdAt), [latest.createdAt]);

  const selectRevisionHandler = useCallback((selectedRevision: string) => {
    setResolvedRevision(selectedRevision);
    setRevisionSelectedToggler(prev => !prev);

    if (!isRevisionselected) {
      setIsRevisionSelected(true);
    }
  }, [isRevisionselected]);

  const resolveConflictHandler = useCallback(async() => {
    const newBody = codeMirrorEditor?.getDocString();
    if (newBody == null) {
      return;
    }

    await conflictDiffModalStatus?.onResolve?.(newBody);
  }, [codeMirrorEditor, conflictDiffModalStatus]);

  useEffect(() => {
    codeMirrorEditor?.initDoc(resolvedRevision);
    // Enable selecting the same revision after editing by including revisionSelectedToggler in the dependency array of useEffect
  }, [codeMirrorEditor, resolvedRevision, revisionSelectedToggler]);

  const headerButtons = useMemo(() => (
    <div className="d-flex align-items-center">
      <button type="button" className="btn" onClick={() => setIsModalExpanded(prev => !prev)}>
        <span className="material-symbols-outlined">{isModalExpanded ? 'close_fullscreen' : 'open_in_full'}</span>
      </button>
      <button type="button" className="btn" onClick={closeConflictDiffModal} aria-label="Close">
        <span className="material-symbols-outlined">close</span>
      </button>
    </div>
  ), [closeConflictDiffModal, isModalExpanded, setIsModalExpanded]);

  return (
    <>
      <ModalHeader tag="h4" className="d-flex align-items-center" close={headerButtons}>
        <span className="material-symbols-outlined me-1">error</span>{t('modal_resolve_conflict.resolve_conflict')}
      </ModalHeader>

      <ModalBody className="mx-4 my-1">
        <div className="row">
          <div className="col-12 text-center mt-2 mb-4">
            <h3 className="fw-bold text-muted">{t('modal_resolve_conflict.resolve_conflict_message')}</h3>
          </div>

          <div className="col-6">
            <h4 className="fw-bold my-2 text-muted">{t('modal_resolve_conflict.requested_revision')}</h4>
            <div className="d-flex align-items-center my-3">
              <div>
                <UserPicture user={request.user} size="lg" noLink noTooltip />
              </div>
              <div className="ms-3 text-muted">
                <p className="my-0">updated by {request.user.username}</p>
                <p className="my-0">{ requestFormattedDate }</p>
              </div>
            </div>
          </div>

          <div className="col-6">
            <h4 className="fw-bold my-2 text-muted">{t('modal_resolve_conflict.latest_revision')}</h4>
            <div className="d-flex align-items-center my-3">
              <div>
                <UserPicture user={latest.user} size="lg" noLink noTooltip />
              </div>
              <div className="ms-3 text-muted">
                <p className="my-0">updated by {latest.user.username}</p>
                <p className="my-0">{ latestFormattedDate }</p>
              </div>
            </div>
          </div>

          <MergeViewer
            leftBody={request.revisionBody}
            rightBody={latest.revisionBody}
          />

          <div className="col-6">
            <div className="text-center my-4">
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => { selectRevisionHandler(request.revisionBody) }}
              >
                <span className="material-symbols-outlined me-1">arrow_circle_down</span>
                {t('modal_resolve_conflict.select_revision', { revision: 'mine' })}
              </button>
            </div>
          </div>

          <div className="col-6">
            <div className="text-center my-4">
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => { selectRevisionHandler(latest.revisionBody) }}
              >
                <span className="material-symbols-outlined me-1">arrow_circle_down</span>
                {t('modal_resolve_conflict.select_revision', { revision: 'theirs' })}
              </button>
            </div>
          </div>

          <div className="col-12">
            <div className="border border-dark">
              <h4 className="fw-bold my-2 mx-2 text-muted">{t('modal_resolve_conflict.selected_editable_revision')}</h4>
              <CodeMirrorEditorDiff />
            </div>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={closeConflictDiffModal}
        >
          {t('Cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary ms-3"
          onClick={resolveConflictHandler}
          disabled={!isRevisionselected}
        >
          {t('modal_resolve_conflict.resolve_and_save')}
        </button>
      </ModalFooter>
    </>
  );
};

/**
 * ConflictDiffModal - Container component (lightweight, always rendered)
 */
export const ConflictDiffModal = (): React.JSX.Element => {
  const currentUser = useCurrentUser();
  const currentPage = useCurrentPageData();
  const conflictDiffModalStatus = useConflictDiffModalStatus();

  // state for latest page
  const remoteRevisionBody = useRemoteRevisionBody();
  const remoteRevisionLastUpdateUser = useRemoteRevisionLastUpdateUser();
  const remoteRevisionLastUpdatedAt = useRemoteRevisionLastUpdatedAt();

  const isRemotePageDataInappropriate = remoteRevisionBody == null || remoteRevisionLastUpdateUser == null;

  const [isModalExpanded, setIsModalExpanded] = useState<boolean>(false);

  // Check if all required data is available
  const isDataReady = conflictDiffModalStatus?.isOpened
    && currentUser != null
    && currentPage != null
    && !isRemotePageDataInappropriate;

  // Prepare data for Substance
  const currentTime: Date = new Date();
  const request: IRevisionOnConflict | null = isDataReady ? {
    revisionBody: conflictDiffModalStatus.requestRevisionBody ?? '',
    createdAt: currentTime,
    user: currentUser,
  } : null;

  const latest: IRevisionOnConflict | null = isDataReady ? {
    revisionBody: remoteRevisionBody,
    createdAt: new Date(remoteRevisionLastUpdatedAt ?? currentTime.toString()),
    user: remoteRevisionLastUpdateUser,
  } : null;

  return (
    <Modal
      isOpen={conflictDiffModalStatus?.isOpened ?? false}
      className={`${styles['conflict-diff-modal']} ${isModalExpanded ? ' grw-modal-expanded' : ''}`}
      size="xl"
    >
      {isDataReady && request != null && latest != null && (
        <ConflictDiffModalSubstance
          request={request}
          latest={latest}
          isModalExpanded={isModalExpanded}
          setIsModalExpanded={setIsModalExpanded}
        />
      )}
    </Modal>
  );
};
