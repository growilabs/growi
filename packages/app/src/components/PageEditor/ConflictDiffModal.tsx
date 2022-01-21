import React, {
  useState, useEffect, FC, useRef,
} from 'react';
import PropTypes from 'prop-types';
import { UserPicture } from '@growi/ui';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import CodeMirror from 'codemirror/lib/codemirror';

import PageContainer from '../../client/services/PageContainer';
import AppContainer from '../../client/services/AppContainer';
import ExpandOrContractButton from '../ExpandOrContractButton';

import { IRevisionOnConflict } from '../../interfaces/revision';
import { UncontrolledCodeMirror } from '../UncontrolledCodeMirror';

require('codemirror/lib/codemirror.css');
require('codemirror/addon/merge/merge');
require('codemirror/addon/merge/merge.css');
const DMP = require('diff_match_patch');

Object.keys(DMP).forEach((key) => { window[key] = DMP[key] });

type ConflictDiffModalProps = {
  isOpen: boolean | null;
  onClose?: (() => void);
  pageContainer: PageContainer;
  appContainer: AppContainer;
  markdownOnEdit: string;
};

type IRevisionOnConflictWithStringDate = Omit<IRevisionOnConflict, 'createdAt'> & {
  createdAt: string
}

export const ConflictDiffModal: FC<ConflictDiffModalProps> = (props) => {
  const { t } = useTranslation('');
  const [resolvedRevision, setResolvedRevision] = useState<string>('');
  const [isRevisionselected, setIsRevisionSelected] = useState<boolean>(false);
  const [isModalExpanded, setIsModalExpanded] = useState<boolean>(false);
  const [codeMirrorRef, setCodeMirrorRef] = useState<HTMLDivElement | null>(null);

  const uncontrolledRef = useRef<CodeMirror>(null);

  const { pageContainer, appContainer } = props;

  const currentTime: Date = new Date();

  const request: IRevisionOnConflictWithStringDate = {
    revisionId: '',
    revisionBody: props.markdownOnEdit,
    createdAt: format(currentTime, 'yyyy/MM/dd HH:mm:ss'),
    user: appContainer.currentUser,
  };
  const origin: IRevisionOnConflictWithStringDate = {
    revisionId: pageContainer.state.revisionId || '',
    revisionBody: pageContainer.state.markdown || '',
    createdAt: pageContainer.state.updatedAt || '',
    user: pageContainer.state.revisionAuthor,
  };
  const latest: IRevisionOnConflictWithStringDate = {
    revisionId: pageContainer.state.remoteRevisionId || '',
    revisionBody: pageContainer.state.remoteRevisionBody || '',
    createdAt: format(new Date(pageContainer.state.remoteRevisionUpdateAt || currentTime.toString()), 'yyyy/MM/dd HH:mm:ss'),
    user: pageContainer.state.lastUpdateUser,
  };

  useEffect(() => {
    if (codeMirrorRef != null) {
      CodeMirror.MergeView(codeMirrorRef, {
        value: origin.revisionBody,
        origLeft: request.revisionBody,
        origRight: latest.revisionBody,
        lineNumbers: true,
        collapseIdentical: true,
        showDifferences: true,
        highlightDifferences: true,
        connect: 'connect',
        readOnly: true,
        revertButtons: false,
      });
    }
  }, [codeMirrorRef, origin.revisionBody, request.revisionBody, latest.revisionBody]);

  const onClose = () => {
    if (props.onClose != null) {
      props.onClose();
    }
  };

  const onResolveConflict = async() : Promise<void> => {
    // disable button after clicked
    setIsRevisionSelected(false);

    const codeMirrorVal = uncontrolledRef.current?.editor.doc.getValue();

    try {
      const editorMode = 'editorOnResolveConflictModal';
      await pageContainer.resolveConflict(codeMirrorVal, editorMode);
      onClose();
      pageContainer.showSuccessToastr();
    }
    catch (error) {
      pageContainer.showErrorToastr(error);
    }

  };

  const onExpandModal = () => {
    setIsModalExpanded(true);
  };

  const onContractModal = () => {
    setIsModalExpanded(false);
  };

  const resizeAndCloseButtons = (
    <div className="d-flex flex-nowrap">
      <ExpandOrContractButton
        isWindowExpanded={isModalExpanded}
        expandWindow={onExpandModal}
        contractWindow={onContractModal}
      />
      <button type="button" className="close text-white" onClick={onClose} aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={props.isOpen || false}
      toggle={onClose}
      backdrop="static"
      className={`${isModalExpanded ? ' grw-modal-expanded' : ''}`}
      size="xl"
    >
      <ModalHeader tag="h4" toggle={onClose} className="bg-primary text-light align-items-center py-3" close={resizeAndCloseButtons}>
        <i className="icon-fw icon-exclamation" />{t('modal_resolve_conflict.resolve_conflict')}
      </ModalHeader>
      <ModalBody className="mx-4 my-1">
        { props.isOpen
        && (
          <div className="row">
            <div className="col-12 text-center mt-2 mb-4">
              <h2 className="font-weight-bold">{t('modal_resolve_conflict.resolve_conflict_message')}</h2>
            </div>
            <div className="col-4">
              <h3 className="font-weight-bold my-2">{t('modal_resolve_conflict.requested_revision')}</h3>
              <div className="d-flex align-items-center my-3">
                <div>
                  <UserPicture user={request.user} size="lg" noLink noTooltip />
                </div>
                <div className="ml-3 text-muted">
                  <p className="my-0">updated by {request.user.username}</p>
                  <p className="my-0">{request.createdAt}</p>
                </div>
              </div>
            </div>
            <div className="col-4">
              <h3 className="font-weight-bold my-2">{t('modal_resolve_conflict.origin_revision')}</h3>
              <div className="d-flex align-items-center my-3">
                <div>
                  <UserPicture user={origin.user} size="lg" noLink noTooltip />
                </div>
                <div className="ml-3 text-muted">
                  <p className="my-0">updated by {origin.user.username}</p>
                  <p className="my-0">{origin.createdAt}</p>
                </div>
              </div>
            </div>
            <div className="col-4">
              <h3 className="font-weight-bold my-2">{t('modal_resolve_conflict.latest_revision')}</h3>
              <div className="d-flex align-items-center my-3">
                <div>
                  <UserPicture user={latest.user} size="lg" noLink noTooltip />
                </div>
                <div className="ml-3 text-muted">
                  <p className="my-0">updated by {latest.user.username}</p>
                  <p className="my-0">{latest.createdAt}</p>
                </div>
              </div>
            </div>
            <div className="col-12" ref={(el) => { setCodeMirrorRef(el) }}></div>
            <div className="col-4">
              <div className="text-center my-4">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => {
                    setIsRevisionSelected(true);
                    setResolvedRevision(request.revisionBody);
                  }}
                >
                  <i className="icon-fw icon-arrow-down-circle"></i>
                  {t('modal_resolve_conflict.select_revision', { revision: 'mine' })}
                </button>
              </div>
            </div>
            <div className="col-4">
              <div className="text-center my-4">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => {
                    setIsRevisionSelected(true);
                    setResolvedRevision(origin.revisionBody);
                  }}
                >
                  <i className="icon-fw icon-arrow-down-circle"></i>
                  {t('modal_resolve_conflict.select_revision', { revision: 'origin' })}
                </button>
              </div>
            </div>
            <div className="col-4">
              <div className="text-center my-4">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => {
                    setIsRevisionSelected(true);
                    setResolvedRevision(latest.revisionBody);
                  }}
                >
                  <i className="icon-fw icon-arrow-down-circle"></i>
                  {t('modal_resolve_conflict.select_revision', { revision: 'theirs' })}
                </button>
              </div>
            </div>
            <div className="col-12">
              <div className="border border-dark">
                <h3 className="font-weight-bold my-2 mx-2">{t('modal_resolve_conflict.selected_editable_revision')}</h3>
                <UncontrolledCodeMirror
                  ref={uncontrolledRef}
                  value={resolvedRevision}
                  options={{
                    placeholder: t('modal_resolve_conflict.resolve_conflict_message'),
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onClose}
        >
          {t('Cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary ml-3"
          onClick={onResolveConflict}
          disabled={!isRevisionselected}
        >
          {t('modal_resolve_conflict.resolve_and_save')}
        </button>
      </ModalFooter>
    </Modal>
  );
};

ConflictDiffModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  pageContainer: PropTypes.instanceOf(PageContainer).isRequired,
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  markdownOnEdit: PropTypes.string.isRequired,
};

ConflictDiffModal.defaultProps = {
  isOpen: false,
};
