import React, { type JSX, useCallback } from 'react';
import { useRouter } from 'next/router';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useTranslation } from 'react-i18next';

import { usePageDeleteModal, usePutBackPageModal } from '~/stores/modal';
import {
  useCurrentPagePath,
  useIsTrashPage,
  useSWRMUTxCurrentPage,
  useSWRxCurrentPage,
  useSWRxPageInfo,
} from '~/stores/page';
import { mutateRecentlyUpdated } from '~/stores/page-listing';
import { useIsAbleToShowTrashPageManagementButtons } from '~/stores/ui';

const onDeletedHandler = (pathOrPathsToDelete) => {
  if (typeof pathOrPathsToDelete !== 'string') {
    return;
  }

  window.location.href = '/';
};

export const TrashPageAlert = (): JSX.Element => {
  const { t } = useTranslation();
  const router = useRouter();

  const { data: isAbleToShowTrashPageManagementButtons } =
    useIsAbleToShowTrashPageManagementButtons();
  const { data: pageData } = useSWRxCurrentPage();
  const { data: isTrashPage } = useIsTrashPage();
  const pageId = pageData?._id;
  const pagePath = pageData?.path;
  const { data: pageInfo } = useSWRxPageInfo(pageId ?? null);

  const { open: openDeleteModal } = usePageDeleteModal();
  const { open: openPutBackPageModal } = usePutBackPageModal();
  const { data: currentPagePath } = useCurrentPagePath();

  const { trigger: mutateCurrentPage } = useSWRMUTxCurrentPage();

  const deleteUser = pageData?.deleteUser;
  const deletedAt = pageData?.deletedAt
    ? format(new Date(pageData?.deletedAt), 'yyyy/MM/dd HH:mm')
    : '';
  const revisionId = pageData?.revision?._id;
  const isEmptyPage = pageId == null || revisionId == null || pagePath == null;

  const openPutbackPageModalHandler = useCallback(() => {
    // User cannot operate empty page.
    if (isEmptyPage) {
      return;
    }
    const putBackedHandler = async () => {
      if (currentPagePath == null) {
        return;
      }
      try {
        const unlink = (await import('~/client/services/page-operation'))
          .unlink;
        unlink(currentPagePath);

        router.push(`/${pageId}`);
        mutateCurrentPage();
        mutateRecentlyUpdated();
      } catch (err) {
        const toastError = (await import('~/client/util/toastr')).toastError;
        toastError(err);
      }
    };
    openPutBackPageModal(
      { pageId, path: pagePath },
      { onPutBacked: putBackedHandler },
    );
  }, [
    currentPagePath,
    mutateCurrentPage,
    openPutBackPageModal,
    pageId,
    pagePath,
    router,
    isEmptyPage,
  ]);

  const openPageDeleteModalHandler = useCallback(() => {
    // User cannot operate empty page.
    if (isEmptyPage) {
      return;
    }
    const pageToDelete = {
      data: {
        _id: pageId,
        revision: revisionId,
        path: pagePath,
      },
      meta: pageInfo,
    };
    openDeleteModal([pageToDelete], { onDeleted: onDeletedHandler });
  }, [openDeleteModal, pageId, pageInfo, pagePath, revisionId, isEmptyPage]);

  const renderTrashPageManagementButtons = useCallback(() => {
    return (
      <>
        <button
          type="button"
          className="btn btn-info rounded-pill btn-sm ms-auto me-2"
          onClick={openPutbackPageModalHandler}
          data-testid="put-back-button"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            undo
          </span>{' '}
          {t('Put Back')}
        </button>
        <button
          type="button"
          className="btn btn-danger rounded-pill btn-sm"
          disabled={!(pageInfo?.isAbleToDeleteCompletely ?? false)}
          onClick={openPageDeleteModalHandler}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            delete_forever
          </span>{' '}
          {t('Delete Completely')}
        </button>
      </>
    );
  }, [
    openPageDeleteModalHandler,
    openPutbackPageModalHandler,
    pageInfo?.isAbleToDeleteCompletely,
    t,
  ]);

  // Show this alert only for non-empty pages in trash.
  if (!isTrashPage || isEmptyPage) {
    return <></>;
  }

  return (
    <>
      <div
        className="alert alert-warning py-3 ps-4 d-flex flex-column flex-lg-row"
        data-testid="trash-page-alert"
      >
        <div className="flex-grow-1">
          This page is in the trash{' '}
          <span className="material-symbols-outlined" aria-hidden="true">
            delete
          </span>
          .
          <br />
          <UserPicture user={deleteUser} />
          <span className="ms-2">
            Deleted by {deleteUser?.name} at{' '}
            <span data-vrt-blackout-datetime>
              {deletedAt ?? pageData?.updatedAt}
            </span>
          </span>
        </div>
        <div className="pt-1 d-flex align-items-end align-items-lg-center">
          {isAbleToShowTrashPageManagementButtons &&
            renderTrashPageManagementButtons()}
        </div>
      </div>
    </>
  );
};
