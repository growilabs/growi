import React, {
  useState, useEffect, useCallback,
} from 'react';
import PropTypes from 'prop-types';

import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { withTranslation } from 'react-i18next';

import { debounce } from 'throttle-debounce';
import { usePageRenameModal } from '~/stores/modal';
import { withUnstatedContainers } from './UnstatedUtils';
import { toastError } from '~/client/util/apiNotification';

import AppContainer from '~/client/services/AppContainer';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';

import ApiErrorMessageList from './PageManagement/ApiErrorMessageList';
import ComparePathsTable from './ComparePathsTable';
import DuplicatedPathsTable from './DuplicatedPathsTable';


const PageRenameModal = (props) => {
  const {
    t, appContainer,
  } = props;

  const { crowi } = appContainer.config;
  const { data: renameModalData, close: closeRenameModal } = usePageRenameModal();

  const { isOpened, page } = renameModalData;
  const { pageId, revisionId, path } = page;

  const [pageNameInput, setPageNameInput] = useState('');

  const [errs, setErrs] = useState(null);

  const [subordinatedPages, setSubordinatedPages] = useState([]);
  const [existingPaths, setExistingPaths] = useState([]);
  const [isRenameRedirect, SetIsRenameRedirect] = useState(false);
  const [isRemainMetadata, SetIsRemainMetadata] = useState(false);
  const [subordinatedError] = useState(null);

  function changeIsRenameRedirectHandler() {
    SetIsRenameRedirect(!isRenameRedirect);
  }

  function changeIsRemainMetadataHandler() {
    SetIsRemainMetadata(!isRemainMetadata);
  }

  const updateSubordinatedList = useCallback(async() => {
    try {
      const res = await apiv3Get('/pages/subordinated-list', { path });
      setSubordinatedPages(res.data.subordinatedPages);
    }
    catch (err) {
      setErrs(err);
      toastError(t('modal_rename.label.Failed to get subordinated pages'));
    }
  }, [path, t]);

  useEffect(() => {
    if (isOpened) {
      updateSubordinatedList();
      setPageNameInput(path);
    }
  }, [isOpened, path, updateSubordinatedList]);


  const checkExistPaths = useCallback(async(newParentPath) => {
    try {
      const res = await apiv3Get('/page/exist-paths', { fromPath: path, toPath: newParentPath });
      const { existPaths } = res.data;
      setExistingPaths(existPaths);
    }
    catch (err) {
      setErrs(err);
      toastError(t('modal_rename.label.Fail to get exist path'));
    }
  }, [path, t]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkExistPathsDebounce = useCallback(() => {
    debounce(1000, checkExistPaths);
  }, [checkExistPaths]);

  useEffect(() => {
    if (pageId != null && path != null && pageNameInput !== path) {
      checkExistPathsDebounce(pageNameInput, subordinatedPages);
    }
  }, [pageNameInput, subordinatedPages, pageId, path, checkExistPathsDebounce]);

  /**
   * change pageNameInput
   * @param {string} value
   */
  function inputChangeHandler(value) {
    setErrs(null);
    setPageNameInput(value);
  }

  async function rename() {
    setErrs(null);

    try {
      const response = await apiv3Put('/pages/rename', {
        revisionId,
        pageId,
        isRenameRedirect,
        isRemainMetadata,
        newPagePath: pageNameInput,
        path,
      });

      const { page } = response.data;
      const url = new URL(page.path, 'https://dummy');
      if (isRenameRedirect) {
        url.searchParams.append('withRedirect', true);
      }

      const onRenamed = renameModalData.opts?.onRenamed;
      if (onRenamed != null) {
        onRenamed(path);
      }
      closeRenameModal();
    }
    catch (err) {
      setErrs(err);
    }
  }

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeRenameModal} autoFocus={false}>
      <ModalHeader tag="h4" toggle={closeRenameModal} className="bg-primary text-light">
        { t('modal_rename.label.Move/Rename page') }
      </ModalHeader>
      <ModalBody>
        <div className="form-group">
          <label>{ t('modal_rename.label.Current page name') }</label><br />
          <code>{ path }</code>
        </div>
        <div className="form-group">
          <label htmlFor="newPageName">{ t('modal_rename.label.New page name') }</label><br />
          <div className="input-group">
            <div className="input-group-prepend">
              <span className="input-group-text">{crowi.url}</span>
            </div>
            <form className="flex-fill" onSubmit={(e) => { e.preventDefault(); rename() }}>
              <input
                type="text"
                value={pageNameInput}
                className="form-control"
                onChange={e => inputChangeHandler(e.target.value)}
                required
                autoFocus
              />
            </form>
          </div>
        </div>
        <p className="mt-0">{ t('modal_rename.help.recursive') }</p>
        {path != null && <ComparePathsTable path={path} subordinatedPages={subordinatedPages} newPagePath={pageNameInput} />}
        {existingPaths.length !== 0 && <DuplicatedPathsTable existingPaths={existingPaths} oldPagePath={pageNameInput} />}

        <div className="custom-control custom-checkbox custom-checkbox-success">
          <input
            className="custom-control-input"
            name="create_redirect"
            id="cbRenameRedirect"
            type="checkbox"
            checked={isRenameRedirect}
            onChange={changeIsRenameRedirectHandler}
          />
          <label className="custom-control-label" htmlFor="cbRenameRedirect">
            { t('modal_rename.label.Redirect') }
            <p className="form-text text-muted mt-0">{ t('modal_rename.help.redirect') }</p>
          </label>
        </div>

        <div className="custom-control custom-checkbox custom-checkbox-primary">
          <input
            className="custom-control-input"
            name="remain_metadata"
            id="cbRemainMetadata"
            type="checkbox"
            checked={isRemainMetadata}
            onChange={changeIsRemainMetadataHandler}
          />
          <label className="custom-control-label" htmlFor="cbRemainMetadata">
            { t('modal_rename.label.Do not update metadata') }
            <p className="form-text text-muted mt-0">{ t('modal_rename.help.metadata') }</p>
          </label>
        </div>
        <div> {subordinatedError} </div>
      </ModalBody>
      <ModalFooter>
        <ApiErrorMessageList errs={errs} targetPath={pageNameInput} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={rename}
          disabled={existingPaths.length !== 0}
        >Rename
        </button>
      </ModalFooter>
    </Modal>
  );
};

/**
 * Wrapper component for using unstated
 */
const PageRenameModalWrapper = withUnstatedContainers(PageRenameModal, [AppContainer]);

PageRenameModal.propTypes = {
  t: PropTypes.func.isRequired, //  i18next
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
};

export default withTranslation()(PageRenameModalWrapper);
