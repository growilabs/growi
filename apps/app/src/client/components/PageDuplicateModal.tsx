import React, {
  useState, useEffect, useCallback, useMemo, type JSX,
} from 'react';

import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import { debounce } from 'throttle-debounce';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { useIsSearchServiceReachable, useSiteUrl } from '~/stores-universal/context';
import { usePageDuplicateModal } from '~/stores/modal';

import DuplicatePathsTable from './DuplicatedPathsTable';
import ApiErrorMessageList from './PageManagement/ApiErrorMessageList';
import PagePathAutoComplete from './PagePathAutoComplete';


const PageDuplicateModal = (): JSX.Element => {
  const { t } = useTranslation();

  const { data: siteUrl } = useSiteUrl();
  const { data: isReachable } = useIsSearchServiceReachable();

  const { data: duplicateModalData, close: closeDuplicateModal } = usePageDuplicateModal();

  const isOpened = duplicateModalData?.isOpened ?? false;
  const page = duplicateModalData?.page;

  const [pageNameInput, setPageNameInput] = useState('');

  const [errs, setErrs] = useState(null);

  const [subordinatedPages, setSubordinatedPages] = useState([]);
  const [existingPaths, setExistingPaths] = useState<string[]>([]);
  const [isDuplicateRecursively, setIsDuplicateRecursively] = useState(true);
  const [isDuplicateRecursivelyWithoutExistPath, setIsDuplicateRecursivelyWithoutExistPath] = useState(true);
  const [onlyDuplicateUserRelatedResources, setOnlyDuplicateUserRelatedResources] = useState(false);

  const updateSubordinatedList = useCallback(async() => {
    if (page == null) {
      return;
    }

    const { path } = page;
    try {
      const res = await apiv3Get('/pages/subordinated-list', { path });
      setSubordinatedPages(res.data.subordinatedPages);
    }
    catch (err) {
      setErrs(err);
      toastError(t('modal_duplicate.label.Failed to get subordinated pages'));
    }
  }, [page, t]);

  const checkExistPaths = useCallback(async(fromPath, toPath) => {
    if (page == null) {
      return;
    }

    try {
      const res = await apiv3Get<{ existPaths: string[] }>('/page/exist-paths', { fromPath, toPath });
      const { existPaths } = res.data;
      setExistingPaths(existPaths);
    }
    catch (err) {
      setErrs(err);
      toastError(t('modal_rename.label.Failed to get exist path'));
    }
  }, [page, t]);

  const checkExistPathsDebounce = useMemo(() => {
    return debounce(1000, checkExistPaths);
  }, [checkExistPaths]);

  useEffect(() => {
    if (isOpened && page != null && pageNameInput !== page.path) {
      checkExistPathsDebounce(page.path, pageNameInput);
    }
  }, [isOpened, pageNameInput, subordinatedPages, checkExistPathsDebounce, page]);

  const ppacInputChangeHandler = useCallback((value: string) => {
    setErrs(null);
    setPageNameInput(value);
  }, []);

  /**
   * change pageNameInput
   * @param {string} value
   */
  function inputChangeHandler(value) {
    setErrs(null);
    setPageNameInput(value);
  }

  function changeIsDuplicateRecursivelyHandler() {
    setIsDuplicateRecursively(!isDuplicateRecursively);
  }

  useEffect(() => {
    if (page != null && isOpened) {
      updateSubordinatedList();
      setPageNameInput(page.path);
    }
  }, [isOpened, page, updateSubordinatedList]);

  const duplicate = useCallback(async() => {
    if (page == null) {
      return;
    }

    setErrs(null);

    const { pageId, path } = page;
    try {
      const { data } = await apiv3Post('/pages/duplicate', {
        pageId, pageNameInput, isRecursively: isDuplicateRecursively, onlyDuplicateUserRelatedResources,
      });
      const onDuplicated = duplicateModalData?.opts?.onDuplicated;
      const fromPath = path;
      const toPath = data.page.path;

      if (onDuplicated != null) {
        onDuplicated(fromPath, toPath);
      }
      closeDuplicateModal();
    }
    catch (err) {
      setErrs(err);
    }
  }, [closeDuplicateModal, duplicateModalData?.opts?.onDuplicated, isDuplicateRecursively, page, pageNameInput, onlyDuplicateUserRelatedResources]);

  useEffect(() => {
    if (isOpened) {
      return;
    }

    // reset states after the modal closed
    setTimeout(() => {
      setPageNameInput('');
      setErrs(null);
      setSubordinatedPages([]);
      setExistingPaths([]);
      setIsDuplicateRecursively(true);
      setIsDuplicateRecursivelyWithoutExistPath(false);
    }, 1000);

  }, [isOpened]);


  const renderBodyContent = () => {
    if (!isOpened || page == null) {
      return <></>;
    }

    const { path } = page;
    const isTargetPageDuplicate = existingPaths.includes(pageNameInput);

    return (
      <>
        <div className="mt-3"><label className="form-label">{t('modal_duplicate.label.Current page name')}</label><br />
          <code>{path}</code>
        </div>
        <div className="mt-3">
          <label className="form-label" htmlFor="duplicatePageName">{ t('modal_duplicate.label.New page name') }</label><br />
          <div className="input-group">
            <div>
              <span className="input-group-text">{siteUrl}</span>
            </div>
            <div className="flex-fill">
              {isReachable
                ? (
                  <PagePathAutoComplete
                    initializedPath={path}
                    onSubmit={duplicate}
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
                  />
                )}
            </div>
          </div>
        </div>

        { isTargetPageDuplicate && (
          <p className="text-danger">Error: Target path is duplicated.</p>
        ) }

        <div className="form-check form-check-warning mt-3">
          <input
            className="form-check-input"
            name="recursively"
            id="cbDuplicateRecursively"
            type="checkbox"
            checked={isDuplicateRecursively}
            onChange={changeIsDuplicateRecursivelyHandler}
          />
          <label className="form-label form-check-label" htmlFor="cbDuplicateRecursively">
            { t('modal_duplicate.label.Recursively') }
            <p className="form-text text-muted my-0">{ t('modal_duplicate.help.recursive') }</p>
          </label>

          <div className="mt-3">
            {isDuplicateRecursively && existingPaths.length !== 0 && (
              <div className="form-check form-check-warning">
                <input
                  className="form-check-input"
                  name="withoutExistRecursively"
                  id="cbDuplicatewithoutExistRecursively"
                  type="checkbox"
                  checked={isDuplicateRecursivelyWithoutExistPath}
                  onChange={() => setIsDuplicateRecursivelyWithoutExistPath(!isDuplicateRecursivelyWithoutExistPath)}
                />
                <label className="form-label form-check-label" htmlFor="cbDuplicatewithoutExistRecursively">
                  { t('modal_duplicate.label.Duplicate without exist path') }
                  <p className="form-text text-muted my-0">{ t('modal_duplicate.help.recursive') }</p>
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="form-check form-check-warning mt-2">
          <input
            className="form-check-input"
            id="cbOnlyDuplicateUserRelatedResources"
            type="checkbox"
            checked={onlyDuplicateUserRelatedResources}
            onChange={() => setOnlyDuplicateUserRelatedResources(!onlyDuplicateUserRelatedResources)}
          />
          <label className="form-label form-check-label" htmlFor="cbOnlyDuplicateUserRelatedResources">
            { t('modal_duplicate.label.Only duplicate user related pages') }
            <p className="form-text text-muted my-0">{ t('modal_duplicate.help.only_inherit_user_related_groups') }</p>
          </label>
        </div>
        <div className="mt-3">
          {isDuplicateRecursively && existingPaths.length !== 0 && (
            <DuplicatePathsTable existingPaths={existingPaths} fromPath={path} toPath={pageNameInput} />
          ) }
        </div>
      </>
    );
  };

  const renderFooterContent = () => {
    if (!isOpened || page == null) {
      return <></>;
    }

    const submitButtonEnabled = existingPaths.length === 0
    || (isDuplicateRecursively && isDuplicateRecursivelyWithoutExistPath);

    return (
      <>
        <ApiErrorMessageList errs={errs} targetPath={pageNameInput} />
        <button
          type="button"
          className="btn btn-primary"
          data-testid="btn-duplicate"
          onClick={duplicate}
          disabled={!submitButtonEnabled}
        >
          { t('modal_duplicate.label.Duplicate page') }
        </button>
      </>
    );
  };


  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeDuplicateModal} data-testid="page-duplicate-modal" className="grw-duplicate-page" autoFocus={false}>
      <ModalHeader tag="h4" toggle={closeDuplicateModal}>
        { t('modal_duplicate.label.Duplicate page') }
      </ModalHeader>
      <ModalBody>
        {renderBodyContent()}
      </ModalBody>
      <ModalFooter>
        {renderFooterContent()}
      </ModalFooter>
    </Modal>
  );
};


export default PageDuplicateModal;
