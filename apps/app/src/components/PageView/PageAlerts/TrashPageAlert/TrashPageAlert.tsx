import { type JSX, useCallback } from 'react';
import { useRouter } from 'next/router';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useTranslation } from 'react-i18next';

import {
  useCurrentPageData,
  useCurrentPagePath,
  useFetchCurrentPage,
  useIsTrashPage,
} from '~/states/page';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete';
import { usePutBackPageModalActions } from '~/states/ui/modal/put-back-page';
import { useIsAbleToShowTrashPageManagementButtons } from '~/states/ui/page-abilities';
import { useSWRxPageInfo } from '~/stores/page';
import { mutateRecentlyUpdated } from '~/stores/page-listing';

const onDeletedHandler = (pathOrPathsToDelete) => {
  if (typeof pathOrPathsToDelete !== 'string') {
    return;
  }

  window.location.href = '/';
};

type SubstanceProps = {
  pageId: string;
  pagePath: string;
  revisionId: string;
};

const TrashPageAlertSubstance = (props: SubstanceProps): JSX.Element => {
  const { t } = useTranslation();
  const router = useRouter();
  const { pageId, pagePath, revisionId } = props;

  const pageData = useCurrentPageData();
  const isAbleToShowTrashPageManagementButtons =
    useIsAbleToShowTrashPageManagementButtons();

  // useSWRxPageInfo is executed only when Substance is rendered
  const { data: pageInfo } = useSWRxPageInfo(pageId);

  const { open: openDeleteModal } = usePageDeleteModalActions();
  const { open: openPutBackPageModal } = usePutBackPageModalActions();
  const currentPagePath = useCurrentPagePath();

  const { fetchCurrentPage } = useFetchCurrentPage();

  const deleteUser = pageData?.deleteUser;
  const deletedAt = pageData?.deletedAt
    ? format(new Date(pageData.deletedAt), 'yyyy/MM/dd HH:mm')
    : '';

  const openPutbackPageModalHandler = useCallback(() => {
    const putBackedHandler = async () => {
      if (currentPagePath == null) {
        return;
      }
      try {
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        const unlink = (await import('~/client/services/page-operation'))
          .unlink;
        unlink(currentPagePath);

        router.push(`/${pageId}`);
        fetchCurrentPage({ force: true });
        mutateRecentlyUpdated();
      } catch (err) {
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        const toastError = (await import('~/client/util/toastr')).toastError;
        toastError(err);
      }
    };
    openPutBackPageModal(
      { pageId, path: pagePath },
      { onPutBacked: putBackedHandler },
    );
  }, [
    openPutBackPageModal,
    pageId,
    pagePath,
    currentPagePath,
    router,
    fetchCurrentPage,
  ]);

  const openPageDeleteModalHandler = useCallback(() => {
    const pageToDelete = {
      data: {
        _id: pageId,
        revision: revisionId,
        path: pagePath,
      },
      meta: pageInfo,
    };
    openDeleteModal([pageToDelete], { onDeleted: onDeletedHandler });
  }, [openDeleteModal, pageId, pageInfo, pagePath, revisionId]);

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

  return (
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
  );
};

export const TrashPageAlert = (): JSX.Element => {
  const pageData = useCurrentPageData();
  const isTrashPage = useIsTrashPage();
  const pageId = pageData?._id;
  const pagePath = pageData?.path;
  const revisionId = pageData?.revision?._id;

  // Lightweight condition checks in Container
  const isEmptyPage = pageId == null || revisionId == null || pagePath == null;

  // Show this alert only for non-empty pages in trash.
  if (!isTrashPage || isEmptyPage) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  // Render Substance only when conditions are met
  // useSWRxPageInfo will be executed only here
  return (
    <TrashPageAlertSubstance
      pageId={pageId}
      pagePath={pagePath}
      revisionId={revisionId}
    />
  );
};
