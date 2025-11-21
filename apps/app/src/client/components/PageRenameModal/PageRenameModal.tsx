import React, {
  useState, useEffect, useCallback, useMemo,
} from 'react';

import { isIPageInfoForEntity } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import {
  Collapse, Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import { debounce } from 'throttle-debounce';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { useSiteUrl } from '~/states/global';
import { isSearchServiceReachableAtom } from '~/states/server-configurations';
import { usePageRenameModalStatus, usePageRenameModalActions } from '~/states/ui/modal/page-rename';
import { useSWRxPageInfo } from '~/stores/page';

import DuplicatedPathsTable from '../DuplicatedPathsTable';
import ApiErrorMessageList from '../PageManagement/ApiErrorMessageList';
import PagePathAutoComplete from '../PagePathAutoComplete';

const isV5Compatible = (meta: unknown): boolean => {
  return isIPageInfoForEntity(meta) ? meta.isV5Compatible : true;
};

/**
 * PageRenameModalSubstance - Heavy processing component (rendered only when modal is open)
 */
const PageRenameModalSubstance: React.FC = () => {
  const { t } = useTranslation();

  const { isUsersHomepage } = pagePathUtils;
  const siteUrl = useSiteUrl();
  const { isOpened, page, opts } = usePageRenameModalStatus();
  const { close: closeRenameModal } = usePageRenameModalActions();
  const isReachable = useAtomValue(isSearchServiceReachableAtom);

  const shouldFetch = isOpened && page != null && !isIPageInfoForEntity(page.meta);
  const { data: pageInfo } = useSWRxPageInfo(shouldFetch ? page?.data._id : null);

  if (page != null && pageInfo != null) {
    page.meta = pageInfo;
  }

  const [pageNameInput, setPageNameInput] = useState('');

  const [errs, setErrs] = useState(null);

  const [subordinatedPages, setSubordinatedPages] = useState([]);
  const [existingPaths, setExistingPaths] = useState<string[]>([]);
  const [isRenameRecursively, setIsRenameRecursively] = useState(true);
  const [isRenameRedirect, setIsRenameRedirect] = useState(false);
  const [isRemainMetadata, setIsRemainMetadata] = useState(false);
  const [expandOtherOptions, setExpandOtherOptions] = useState(false);
  const [subordinatedError] = useState(null);
  const [isMatchedWithUserHomepagePath, setIsMatchedWithUserHomepagePath] = useState(false);

  const updateSubordinatedList = useCallback(async() => {
    if (page == null) {
      return;
    }

    const { path } = page.data;
    try {
      const res = await apiv3Get('/pages/subordinated-list', { path });
      setSubordinatedPages(res.data.subordinatedPages);
    }
    catch (err) {
      setErrs(err);
      toastError(t('modal_rename.label.Failed to get subordinated pages'));
    }
  }, [page, t]);

  useEffect(() => {
    if (page != null && isOpened) {
      updateSubordinatedList();
      setPageNameInput(page.data.path);
    }
  }, [isOpened, page, updateSubordinatedList]);

  // Memoize computed values
  const isTargetPageDuplicate = useMemo(() => existingPaths.includes(pageNameInput), [existingPaths, pageNameInput]);
  const isV5CompatiblePage = useMemo(() => (page != null ? isV5Compatible(page.meta) : true), [page]);

  const canRename = useMemo(() => {
    if (page == null || isMatchedWithUserHomepagePath || page.data.path === pageNameInput) {
      return false;
    }
    if (isV5CompatiblePage) {
      return existingPaths.length === 0; // v5 data
    }
    return isRenameRecursively; // v4 data
  }, [existingPaths.length, isMatchedWithUserHomepagePath, isRenameRecursively, page, pageNameInput, isV5CompatiblePage]);

  const rename = useCallback(async() => {
    if (page == null || !canRename) {
      return;
    }

    const _isV5Compatible = isV5Compatible(page.meta);

    setErrs(null);

    const { _id, path, revision } = page.data;
    try {
      const response = await apiv3Put('/pages/rename', {
        pageId: _id,
        revisionId: revision ?? null,
        isRecursively: !_isV5Compatible ? isRenameRecursively : undefined,
        isRenameRedirect,
        updateMetadata: !isRemainMetadata,
        newPagePath: pageNameInput,
        path,
      });

      const { page } = response.data;
      const url = new URL(page.path, 'https://dummy');
      if (isRenameRedirect) {
        url.searchParams.append('withRedirect', 'true');
      }

      const onRenamed = opts?.onRenamed;
      if (onRenamed != null) {
        onRenamed(path);
      }
      closeRenameModal();
    }
    catch (err) {
      setErrs(err);
    }
  }, [closeRenameModal, canRename, isRemainMetadata, isRenameRecursively, isRenameRedirect, page, pageNameInput, opts?.onRenamed]);

  const checkExistPaths = useCallback(async(fromPath, toPath) => {
    if (page == null) {
      return;
    }

    try {
      const res = await apiv3Get<{ existPaths: string[]}>('/page/exist-paths', { fromPath, toPath });
      const { existPaths } = res.data;
      setExistingPaths(existPaths);
    }
    catch (err) {
      // Do not toast in case of this error because debounce process may be executed after the renaming process is completed.
      if (err.length === 1 && err[0].code === 'from-page-is-not-exist') {
        return;
      }
      setErrs(err);
      toastError(t('modal_rename.label.Failed to get exist path'));
    }
  }, [page, t]);

  const checkExistPathsDebounce = useMemo(() => {
    return debounce(1000, checkExistPaths);
  }, [checkExistPaths]);

  const checkIsUsersHomepageDebounce = useMemo(() => {
    const checkIsPagePathRenameable = (pageNameInput: string) => {
      setIsMatchedWithUserHomepagePath(isUsersHomepage(pageNameInput));
    };

    return debounce(1000, checkIsPagePathRenameable);
  }, [isUsersHomepage]);

  useEffect(() => {
    if (isOpened && page != null && pageNameInput !== page.data.path) {
      checkExistPathsDebounce(page.data.path, pageNameInput);
      checkIsUsersHomepageDebounce(pageNameInput);
    }
  }, [isOpened, pageNameInput, subordinatedPages, checkExistPathsDebounce, page, checkIsUsersHomepageDebounce]);

  const ppacInputChangeHandler = useCallback((value: string) => {
    setErrs(null);
    setPageNameInput(value);
  }, []);

  /**
   * change pageNameInput
   * @param {string} value
   */
  const inputChangeHandler = useCallback((value) => {
    setErrs(null);
    setPageNameInput(value);
  }, []);

  useEffect(() => {
    if (isOpened || page == null) {
      return;
    }

    // reset states after the modal closed
    setTimeout(() => {
      setPageNameInput('');
      setErrs(null);
      setSubordinatedPages([]);
      setExistingPaths([]);
      setIsRenameRecursively(true);
      setIsRenameRedirect(false);
      setIsRemainMetadata(false);
      setExpandOtherOptions(false);
    }, 1000);

  }, [isOpened, page]);

  const bodyContent = () => {
    if (!isOpened || page == null) {
      return <></>;
    }

    const { path } = page.data;

    return (
      <>
        <div className="mb-3">
          <label className="form-label w-100">{ t('modal_rename.label.Current page name') }</label>
          <code className="fs-6">{ path }</code>
        </div>
        <div className="mb-3">
          <label htmlFor="newPageName" className="form-label w-100">{ t('modal_rename.label.New page name') }</label>
          <div className="input-group">
            <div>
              <span className="input-group-text">{siteUrl}</span>
            </div>
            <form className="flex-fill" onSubmit={(e) => { e.preventDefault(); rename() }}>
              {isReachable
                ? (
                  <PagePathAutoComplete
                    initializedPath={path}
                    onSubmit={rename}
                    onInputChange={ppacInputChangeHandler}
                    autoFocus
                  />
                )
                : (
                  <input
                    type="text"
                    value={pageNameInput}
                    className="form-control"
                    onChange={e => inputChangeHandler(e.target.value)}
                    required
                    autoFocus
                  />
                )}
            </form>
          </div>
          { isTargetPageDuplicate && (
            <p className="text-danger">Error: Target path is duplicated.</p>
          ) }
          { isMatchedWithUserHomepagePath && (
            <p className="text-danger">Error: Cannot move to directory under /user page.</p>
          ) }
        </div>

        { !isV5Compatible(page.meta) && (
          <>
            <div className="form-check form-check-warning">
              <input
                className="form-check-input"
                name="withoutExistRecursively"
                id="cbRenameThisPageOnly"
                type="radio"
                checked={!isRenameRecursively}
                onChange={() => setIsRenameRecursively(!isRenameRecursively)}
              />
              <label className="form-label form-check-label" htmlFor="cbRenameThisPageOnly">
                { t('modal_rename.label.Rename this page only') }
              </label>
            </div>
            <div className="form-check form-check-warning mt-1">
              <input
                className="form-check-input"
                name="recursively"
                id="cbForceRenameRecursively"
                type="radio"
                checked={isRenameRecursively}
                onChange={() => setIsRenameRecursively(!isRenameRecursively)}
              />
              <label className="form-label form-check-label" htmlFor="cbForceRenameRecursively">
                { t('modal_rename.label.Force rename all child pages') }
                <p className="form-text text-muted mt-0">{ t('modal_rename.help.recursive') }</p>
              </label>
              {isRenameRecursively && existingPaths.length !== 0 && (
                <DuplicatedPathsTable existingPaths={existingPaths} fromPath={path} toPath={pageNameInput} />
              ) }
            </div>
          </>
        ) }

        <p className="mt-2">
          <button type="button" className="btn btn-link mt-2 p-0" aria-expanded="false" onClick={() => setExpandOtherOptions(!expandOtherOptions)}>
            <span className={`material-symbols-outlined me-1 ${expandOtherOptions ? 'rotate-90' : ''}`}>navigate_next</span>
            { t('modal_rename.label.Other options') }
          </button>
        </p>
        <Collapse isOpen={expandOtherOptions}>
          <div className="form-check form-check-success">
            <input
              className="form-check-input"
              name="create_redirect"
              id="cbRenameRedirect"
              type="checkbox"
              checked={isRenameRedirect}
              onChange={() => setIsRenameRedirect(!isRenameRedirect)}
            />
            <label className="form-label form-check-label" htmlFor="cbRenameRedirect">
              { t('modal_rename.label.Redirect') }
              <p className="form-text text-muted mt-0">{ t('modal_rename.help.redirect') }</p>
            </label>
          </div>

          <div className="form-check form-check-success">
            <input
              className="form-check-input"
              name="remain_metadata"
              id="cbRemainMetadata"
              type="checkbox"
              checked={isRemainMetadata}
              onChange={() => setIsRemainMetadata(!isRemainMetadata)}
            />
            <label className="form-label form-check-label" htmlFor="cbRemainMetadata">
              { t('modal_rename.label.Do not update metadata') }
              <p className="form-text text-muted mt-0">{ t('modal_rename.help.metadata') }</p>
            </label>
          </div>
          <div> {subordinatedError} </div>
        </Collapse>
      </>
    );
  };

  const footerContent = () => {
    if (!isOpened || page == null) {
      return <></>;
    }

    const submitButtonDisabled = !canRename;

    return (
      <>
        <ApiErrorMessageList errs={errs} targetPath={pageNameInput} />
        <button
          data-testid="grw-page-rename-button"
          type="button"
          className="btn btn-primary"
          onClick={rename}
          disabled={submitButtonDisabled}
        >Rename
        </button>
      </>
    );
  };

  return (
    <>
      <ModalHeader tag="h4" toggle={closeRenameModal}>
        { t('modal_rename.label.Move/Rename page') }
      </ModalHeader>
      <ModalBody>
        {bodyContent()}
      </ModalBody>
      <ModalFooter>
        {footerContent()}
      </ModalFooter>
    </>
  );
};

/**
 * PageRenameModal - Container component (lightweight, always rendered)
 */
export const PageRenameModal = (): React.JSX.Element => {
  const { isOpened } = usePageRenameModalStatus();
  const { close: closeRenameModal } = usePageRenameModalActions();

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeRenameModal} data-testid="page-rename-modal" autoFocus={false}>
      {isOpened && <PageRenameModalSubstance />}
    </Modal>
  );
};
