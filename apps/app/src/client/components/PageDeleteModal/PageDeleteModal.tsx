import type { FC } from 'react';
import React, {
  useState, useMemo, useEffect, useCallback,
} from 'react';

import type { IPageInfoForEntity, IPageToDeleteWithMeta } from '@growi/core';
import { isIPageInfoForEntity } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { apiPost } from '~/client/util/apiv1-client';
import { apiv3Post } from '~/client/util/apiv3-client';
import type { IDeleteSinglePageApiv1Result, IDeleteManyPageApiv3Result } from '~/interfaces/page';
import { usePageDeleteModalStatus, usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import { useSWRxPageInfoForList } from '~/stores/page-listing';
import loggerFactory from '~/utils/logger';


import ApiErrorMessageList from '../PageManagement/ApiErrorMessageList';

const { isTrashPage } = pagePathUtils;


const logger = loggerFactory('growi:cli:PageDeleteModal');


const deleteIconAndKey = {
  completely: {
    color: 'danger',
    icon: 'delete_forever',
    translationKey: 'completely',
  },
  temporary: {
    color: 'warning',
    icon: 'delete',
    translationKey: 'page',
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isIPageInfoForEntityForDeleteModal = (pageInfo: any | undefined): pageInfo is IPageInfoForEntity => {
  return pageInfo != null && 'isDeletable' in pageInfo && 'isAbleToDeleteCompletely' in pageInfo;
};

export const PageDeleteModal: FC = () => {
  const { t } = useTranslation();
  const { isOpened, pages, opts } = usePageDeleteModalStatus() ?? {};
  const { close: closeDeleteModal } = usePageDeleteModalActions();

  // Optimize deps: use page IDs and length instead of pages array reference
  const pageIds = useMemo(() => pages?.map(p => p.data._id) ?? [], [pages]);
  const pagesLength = pages?.length ?? 0;

  const notOperatablePages: IPageToDeleteWithMeta[] = useMemo(() => (pages ?? []).filter(p => !isIPageInfoForEntityForDeleteModal(p.meta)),
    // Optimization: Use pageIds and pagesLength instead of pages array reference to avoid unnecessary re-computation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageIds, pagesLength]);

  const notOperatablePageIds = useMemo(() => notOperatablePages.map(p => p.data._id), [notOperatablePages]);

  const { injectTo } = useSWRxPageInfoForList(notOperatablePageIds);

  // inject IPageInfo to operate
  const injectedPages = useMemo(() => {
    if (pages != null) {
      return injectTo(pages);
    }
    return null;
  },
  // Optimization: Use pageIds and pagesLength instead of pages array reference to avoid unnecessary re-computation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pageIds, pagesLength, injectTo]);

  // calculate conditions to delete
  const [isDeletable, isAbleToDeleteCompletely] = useMemo(() => {
    if (injectedPages != null && injectedPages.length > 0) {
      const isDeletable = injectedPages.every(pageWithMeta => pageWithMeta.meta?.isDeletable);
      const isAbleToDeleteCompletely = injectedPages.every(pageWithMeta => pageWithMeta.meta?.isAbleToDeleteCompletely);
      return [isDeletable, isAbleToDeleteCompletely];
    }
    return [true, true];
  }, [injectedPages]);

  // Optimize deps: use page paths for trash detection
  const pagePaths = useMemo(() => pages?.map(p => p.data?.path ?? '') ?? [],
    // Optimization: Use pageIds and pagesLength instead of pages array reference to avoid unnecessary re-computation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageIds, pagesLength]);

  // calculate condition to determine modal status
  const forceDeleteCompletelyMode = useMemo(() => {
    if (pagesLength > 0) {
      return pagePaths.every(path => isTrashPage(path));
    }
    return false;
  }, [pagePaths, pagesLength]);

  const [isDeleteRecursively, setIsDeleteRecursively] = useState(true);
  const [isDeleteCompletely, setIsDeleteCompletely] = useState(forceDeleteCompletelyMode);
  const deleteMode = forceDeleteCompletelyMode || isDeleteCompletely ? 'completely' : 'temporary';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [errs, setErrs] = useState<Error[] | null>(null);

  // initialize when opening modal
  useEffect(() => {
    if (isOpened) {
      setIsDeleteRecursively(true);
      setIsDeleteCompletely(forceDeleteCompletelyMode);
    }
  }, [forceDeleteCompletelyMode, isOpened]);

  useEffect(() => {
    setIsDeleteCompletely(forceDeleteCompletelyMode);
  }, [forceDeleteCompletelyMode]);

  const changeIsDeleteRecursivelyHandler = useCallback(() => {
    setIsDeleteRecursively(!isDeleteRecursively);
  }, [isDeleteRecursively]);

  const changeIsDeleteCompletelyHandler = useCallback(() => {
    if (forceDeleteCompletelyMode) {
      return;
    }
    setIsDeleteCompletely(!isDeleteCompletely);
  }, [forceDeleteCompletelyMode, isDeleteCompletely]);

  const deletePage = useCallback(async() => {
    if (pages == null) {
      return;
    }

    if (!isDeletable) {
      logger.error('At least one page is not deletable.');
      return;
    }

    /*
     * When multiple pages
     */
    if (pages.length > 1) {
      try {
        const isRecursively = isDeleteRecursively === true ? true : undefined;
        const isCompletely = isDeleteCompletely === true ? true : undefined;

        const pageIdToRevisionIdMap = {};
        pages.forEach((p) => { pageIdToRevisionIdMap[p.data._id] = p.data.revision as string });

        const { data } = await apiv3Post<IDeleteManyPageApiv3Result>('/pages/delete', {
          pageIdToRevisionIdMap,
          isRecursively,
          isCompletely,
        });

        const onDeleted = opts?.onDeleted;
        if (onDeleted != null) {
          onDeleted(data.paths, data.isRecursively, data.isCompletely);
        }
        closeDeleteModal();
      }
      catch (err) {
        setErrs([err]);
      }
    }
    /*
     * When single page
     */
    else {
      try {
        const recursively = isDeleteRecursively === true ? true : undefined;
        const completely = forceDeleteCompletelyMode || isDeleteCompletely ? true : undefined;

        const page = pages[0].data;

        const { path, isRecursively, isCompletely } = await apiPost('/pages.remove', {
          page_id: page._id,
          revision_id: page.revision,
          recursively,
          completely,
        }) as IDeleteSinglePageApiv1Result;

        const onDeleted = opts?.onDeleted;
        if (onDeleted != null) {
          onDeleted(path, isRecursively, isCompletely);
        }

        closeDeleteModal();
      }
      catch (err) {
        setErrs([err]);
      }
    }
  },
  // Optimization: Use pageIds and pagesLength instead of pages array reference to avoid unnecessary re-computation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pageIds, pagesLength, isDeletable, isDeleteRecursively, isDeleteCompletely, forceDeleteCompletelyMode, opts?.onDeleted, closeDeleteModal]);

  const deleteButtonHandler = useCallback(async() => {
    await deletePage();
  }, [deletePage]);

  const renderDeleteRecursivelyForm = useCallback(() => {
    return (
      <div className="form-check form-check-warning">
        <input
          className="form-check-input"
          id="deleteRecursively"
          type="checkbox"
          checked={isDeleteRecursively}
          onChange={changeIsDeleteRecursivelyHandler}
          // disabled // Todo: enable this at https://redmine.weseek.co.jp/issues/82222
        />
        <label className="form-label form-check-label" htmlFor="deleteRecursively">
          { t('modal_delete.delete_recursively') }
          <p className="form-text text-muted mt-0"> { t('modal_delete.recursively') }</p>
        </label>
      </div>
    );
  }, [isDeleteRecursively, changeIsDeleteRecursivelyHandler, t]);

  const renderDeleteCompletelyForm = useCallback(() => {
    return (
      <div className="form-check form-check-danger">
        <input
          className="form-check-input"
          name="completely"
          id="deleteCompletely"
          type="checkbox"
          disabled={!isAbleToDeleteCompletely}
          checked={isDeleteCompletely}
          onChange={changeIsDeleteCompletelyHandler}
        />
        <label className="form-label form-check-label" htmlFor="deleteCompletely">
          { t('modal_delete.delete_completely')}
          <p className="form-text text-muted mt-0"> { t('modal_delete.completely') }</p>
        </label>
        {!isAbleToDeleteCompletely
        && (
          <p className="alert alert-warning p-2 my-0">
            <span className="material-symbols-outlined">block</span>{ t('modal_delete.delete_completely_restriction') }
          </p>
        )}
      </div>
    );
  }, [isAbleToDeleteCompletely, isDeleteCompletely, changeIsDeleteCompletelyHandler, t]);

  const headerContent = useMemo(() => {
    if (!isOpened) {
      return <></>;
    }

    return (
      <span className={`text-${deleteIconAndKey[deleteMode].color} d-flex align-items-center`}>
        <span className="material-symbols-outlined me-1">{deleteIconAndKey[deleteMode].icon}</span>
        <b>{ t(`modal_delete.delete_${deleteIconAndKey[deleteMode].translationKey}`) }</b>
      </span>
    );
  }, [isOpened, deleteMode, t]);

  const bodyContent = useMemo(() => {
    if (!isOpened) {
      return <></>;
    }

    // Render page paths to delete inline for better performance
    const renderingPages = injectedPages != null && injectedPages.length > 0 ? injectedPages : pages;
    const pagePathsElements = renderingPages != null ? renderingPages.map(page => (
      <p key={page.data._id} className="mb-1">
        <code>{ page.data.path }</code>
        { isIPageInfoForEntity(page.meta)
          && !page.meta.isDeletable
          && <span className="ms-3 text-danger"><strong>(CAN NOT TO DELETE)</strong></span> }
      </p>
    )) : <></>;

    return (
      <>
        <div className="grw-scrollable-modal-body pb-1">
          <label className="form-label">{ t('modal_delete.deleting_page') }:</label><br />
          {/* Todo: change the way to show path on modal when too many pages are selected */}
          {pagePathsElements}
        </div>
        { isDeletable && renderDeleteRecursivelyForm()}
        { isDeletable && !forceDeleteCompletelyMode && renderDeleteCompletelyForm() }
      </>
    );
    // Optimization: Use direct dependencies instead of JSX.Element reference for better performance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpened, t, pageIds, pagesLength, injectedPages, isDeletable, renderDeleteRecursivelyForm, forceDeleteCompletelyMode, renderDeleteCompletelyForm]);

  const footerContent = useMemo(() => {
    if (!isOpened) {
      return <></>;
    }

    return (
      <>
        <ApiErrorMessageList errs={errs} />
        <button
          type="button"
          className={`btn btn-outline-${deleteIconAndKey[deleteMode].color}`}
          disabled={!isDeletable}
          onClick={deleteButtonHandler}
          data-testid="delete-page-button"
        >
          <span className="material-symbols-outlined me-1" aria-hidden="true">{deleteIconAndKey[deleteMode].icon}</span>
          { t(`modal_delete.delete_${deleteIconAndKey[deleteMode].translationKey}`) }
        </button>
      </>
    );
  }, [isOpened, errs, deleteMode, isDeletable, deleteButtonHandler, t]);

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeDeleteModal} data-testid="page-delete-modal">
      <ModalHeader toggle={closeDeleteModal}>
        {headerContent}
      </ModalHeader>
      <ModalBody>
        {bodyContent}
      </ModalBody>
      <ModalFooter>
        {footerContent}
      </ModalFooter>
    </Modal>

  );
};
