import React, { useState, FC, useMemo } from 'react';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import { useTranslation } from 'react-i18next';

import { apiPost } from '~/client/util/apiv1-client';
import { apiv3Post } from '~/client/util/apiv3-client';
import { usePageDeleteModal } from '~/stores/modal';
import loggerFactory from '~/utils/logger';

import {
  IDeleteSinglePageApiv1Result, IDeleteManyPageApiv3Result, IPageToDeleteWithMeta, IDataWithMeta, isIPageInfoForEntity, IPageInfoForEntity,
} from '~/interfaces/page';
import { HasObjectId } from '~/interfaces/has-object-id';

import ApiErrorMessageList from './PageManagement/ApiErrorMessageList';
import { isTrashPage } from '^/../core/src/utils/page-path-utils';
import { useSWRxPageInfoForList } from '~/stores/page';


const logger = loggerFactory('growi:cli:PageDeleteModal');


const deleteIconAndKey = {
  completely: {
    color: 'danger',
    icon: 'fire',
    translationKey: 'completely',
  },
  temporary: {
    color: 'primary',
    icon: 'trash',
    translationKey: 'page',
  },
};

const PageDeleteModal: FC = () => {
  const { t } = useTranslation();

  const { data: deleteModalData, close: closeDeleteModal } = usePageDeleteModal();

  const isOpened = deleteModalData?.isOpened ?? false;

  const notOperatablePages: IPageToDeleteWithMeta[] = (deleteModalData?.pages ?? [])
    .filter(p => !isIPageInfoForEntity(p.meta));
  const notOperatablePageIds = notOperatablePages.map(p => p.data._id);

  const { injectTo } = useSWRxPageInfoForList(notOperatablePageIds);

  // inject IPageInfo to operate
  let injectedPages: IDataWithMeta<HasObjectId & { path: string }, IPageInfoForEntity>[] | null = null;
  if (deleteModalData?.pages != null && notOperatablePageIds.length > 0) {
    injectedPages = injectTo(deleteModalData?.pages);
  }

  // calculate conditions to delete
  const [isDeletable, isAbleToDeleteCompletely] = useMemo(() => {
    if (injectedPages != null && injectedPages.length > 0) {
      const isDeletable = injectedPages.every(pageWithMeta => pageWithMeta.meta?.isDeletable);
      const isAbleToDeleteCompletely = injectedPages.every(pageWithMeta => pageWithMeta.meta?.isAbleToDeleteCompletely);
      return [isDeletable, isAbleToDeleteCompletely];
    }
    return [true, true];
  }, [injectedPages]);

  // calculate condition to determine modal status
  const forceDeleteCompletelyMode = useMemo(() => {
    if (deleteModalData != null && deleteModalData.pages != null && deleteModalData.pages.length > 0) {
      return deleteModalData.pages.every(pageWithMeta => isTrashPage(pageWithMeta.data?.path ?? ''));
    }
    return false;
  }, [deleteModalData]);

  const [isDeleteRecursively, setIsDeleteRecursively] = useState(true);
  const [isDeleteCompletely, setIsDeleteCompletely] = useState(forceDeleteCompletelyMode);
  const deleteMode = forceDeleteCompletelyMode || isDeleteCompletely ? 'completely' : 'temporary';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [errs, setErrs] = useState<Error[] | null>(null);

  function changeIsDeleteRecursivelyHandler() {
    setIsDeleteRecursively(!isDeleteRecursively);
  }

  function changeIsDeleteCompletelyHandler() {
    if (forceDeleteCompletelyMode) {
      return;
    }
    setIsDeleteCompletely(!isDeleteCompletely);
  }

  async function deletePage() {
    if (deleteModalData == null || deleteModalData.pages == null) {
      return;
    }

    if (!isDeletable) {
      logger.error('At least one page is not deletable.');
      return;
    }

    /*
     * When multiple pages
     */
    if (deleteModalData.pages.length > 1) {
      try {
        const isRecursively = isDeleteRecursively === true ? true : undefined;
        const isCompletely = isDeleteCompletely === true ? true : undefined;

        const pageIdToRevisionIdMap = {};
        deleteModalData.pages.forEach((p) => { pageIdToRevisionIdMap[p.data._id] = p.data.revision as string });

        const { data } = await apiv3Post<IDeleteManyPageApiv3Result>('/pages/delete', {
          pageIdToRevisionIdMap,
          isRecursively,
          isCompletely,
        });

        const onDeleted = deleteModalData.opts?.onDeleted;
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

        const page = deleteModalData.pages[0].data;

        const { path, isRecursively, isCompletely } = await apiPost('/pages.remove', {
          page_id: page._id,
          revision_id: page.revision,
          recursively,
          completely,
        }) as IDeleteSinglePageApiv1Result;

        const onDeleted = deleteModalData.opts?.onDeleted;
        if (onDeleted != null) {
          onDeleted(path, isRecursively, isCompletely);
        }

        closeDeleteModal();
      }
      catch (err) {
        setErrs([err]);
      }
    }
  }

  async function deleteButtonHandler() {
    await deletePage();
  }

  function renderDeleteRecursivelyForm() {
    return (
      <div className="custom-control custom-checkbox custom-checkbox-warning">
        <input
          className="custom-control-input"
          id="deleteRecursively"
          type="checkbox"
          checked={isDeleteRecursively}
          onChange={changeIsDeleteRecursivelyHandler}
          // disabled // Todo: enable this at https://redmine.weseek.co.jp/issues/82222
        />
        <label className="custom-control-label" htmlFor="deleteRecursively">
          { t('modal_delete.delete_recursively') }
          <p className="form-text text-muted mt-0"> { t('modal_delete.recursively') }</p>
        </label>
      </div>
    );
  }

  function renderDeleteCompletelyForm() {
    return (
      <div className="custom-control custom-checkbox custom-checkbox-danger">
        <input
          className="custom-control-input"
          name="completely"
          id="deleteCompletely"
          type="checkbox"
          disabled={!isAbleToDeleteCompletely}
          checked={isDeleteCompletely}
          onChange={changeIsDeleteCompletelyHandler}
        />
        <label className="custom-control-label" htmlFor="deleteCompletely">
          { t('modal_delete.delete_completely')}
          <p className="form-text text-muted mt-0"> { t('modal_delete.completely') }</p>
        </label>
        {!isAbleToDeleteCompletely
        && (
          <p className="alert alert-warning p-2 my-0">
            <i className="icon-ban icon-fw"></i>{ t('modal_delete.delete_completely_restriction') }
          </p>
        )}
      </div>
    );
  }

  const renderPagePathsToDelete = () => {
    const pages = injectedPages != null && injectedPages.length > 0 ? injectedPages : deleteModalData?.pages;

    if (pages != null) {
      return pages.map(page => (
        <p key={page.data._id} className="mb-1">
          <code>{ page.data.path }</code>
          { !page.meta?.isDeletable && <span className="ml-3 text-danger"><strong>(CAN NOT TO DELETE)</strong></span> }
        </p>
      ));
    }
    return <></>;
  };

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeDeleteModal} data-testid="page-delete-modal" className="grw-create-page">
      <ModalHeader tag="h4" toggle={closeDeleteModal} className={`bg-${deleteIconAndKey[deleteMode].color} text-light`}>
        <i className={`icon-fw icon-${deleteIconAndKey[deleteMode].icon}`}></i>
        { t(`modal_delete.delete_${deleteIconAndKey[deleteMode].translationKey}`) }
      </ModalHeader>
      <ModalBody>
        <div className="form-group grw-scrollable-modal-body pb-1">
          <label>{ t('modal_delete.deleting_page') }:</label><br />
          {/* Todo: change the way to show path on modal when too many pages are selected */}
          {/* https://redmine.weseek.co.jp/issues/82787 */}
          {renderPagePathsToDelete()}
        </div>
        { isDeletable && renderDeleteRecursivelyForm()}
        { isDeletable && !forceDeleteCompletelyMode && renderDeleteCompletelyForm() }
      </ModalBody>
      <ModalFooter>
        <ApiErrorMessageList errs={errs} />
        <button
          type="button"
          className={`btn btn-${deleteIconAndKey[deleteMode].color}`}
          disabled={!isDeletable}
          onClick={deleteButtonHandler}
        >
          <i className={`icon-${deleteIconAndKey[deleteMode].icon}`} aria-hidden="true"></i>
          { t(`modal_delete.delete_${deleteIconAndKey[deleteMode].translationKey}`) }
        </button>
      </ModalFooter>
    </Modal>

  );
};

export default PageDeleteModal;
