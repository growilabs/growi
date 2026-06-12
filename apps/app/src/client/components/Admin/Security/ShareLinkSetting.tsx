import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import { apiv3Delete } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import ShareLinkList from '../../PageAccessoriesModal/ShareLink/ShareLinkList';
import PaginationWrapper from '../../PaginationWrapper';
import { withUnstatedContainers } from '../../UnstatedUtils';
import DeleteAllShareLinksModal from './DeleteAllShareLinksModal';

type PagerProps = {
  activePage: number;
  pagingHandler: (page: number) => Promise<void>;
  totalLinks: number;
  limit: number;
};

type ShareLinkSettingProps = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer;
};

const Pager = (props: PagerProps) => {
  const { activePage, pagingHandler, totalLinks, limit } = props;

  return (
    <PaginationWrapper
      activePage={activePage}
      changePage={pagingHandler}
      totalItemsCount={totalLinks}
      pagingLimit={limit}
      align="center"
      size="sm"
    />
  );
};

const ShareLinkSetting = (props: ShareLinkSettingProps) => {
  const { t } = useTranslation('admin');
  const { adminGeneralSecurityContainer } = props;
  const {
    shareLinks,
    shareLinksActivePage,
    totalshareLinks,
    shareLinksPagingLimit,
    disableLinkSharing,
    setupStrategies,
  } = adminGeneralSecurityContainer.state;
  const [isDeleteConfirmModalShown, setIsDeleteConfirmModalShown] =
    useState<boolean>();

  const getShareLinkList = useCallback(
    async (page: number) => {
      try {
        await adminGeneralSecurityContainer.retrieveShareLinksByPagingNum(page);
      } catch (err) {
        toastError(err);
      }
    },
    [adminGeneralSecurityContainer],
  );

  // for Next routing
  useEffect(() => {
    getShareLinkList(1);
  }, [getShareLinkList]);

  const deleteAllLinksButtonHandler = useCallback(async () => {
    try {
      const res = await apiv3Delete('/share-links/all');
      const { deletedCount } = res.data;
      toastSuccess(
        t('toaster.remove_share_link', { count: deletedCount, ns: 'commons' }),
      );
    } catch (err) {
      toastError(err);
    }
    getShareLinkList(1);
  }, [getShareLinkList, t]);

  const deleteLinkById = useCallback(
    async (shareLinkId: string) => {
      try {
        const res = await apiv3Delete(`/share-links/${shareLinkId}`);
        const { deletedShareLink } = res.data;
        toastSuccess(
          t('toaster.remove_share_link_success', {
            shareLinkId: deletedShareLink._id,
            ns: 'commons',
          }),
        );
      } catch (err) {
        toastError(err);
      }
      getShareLinkList(shareLinksActivePage);
    },
    [shareLinksActivePage, getShareLinkList, t],
  );

  const switchDisableLinkSharing = useCallback(async () => {
    try {
      await adminGeneralSecurityContainer.switchDisableLinkSharing();
      toastSuccess(t('toaster.switch_disable_link_sharing_success'));
    } catch (err) {
      toastError(err);
    }
  }, [adminGeneralSecurityContainer, t]);

  return (
    <>
      <h2 className="alert-anchor border-bottom mb-4">
        {t('security_settings.share_link_management')}
      </h2>
      <h4>{t('security_settings.share_link_rights')}</h4>
      <div className="row mt-4 mb-5">
        <div className="col-6 offset-3">
          <div className="form-check form-switch form-check-success">
            <input
              type="checkbox"
              className="form-check-input"
              id="disableLinkSharing"
              checked={!disableLinkSharing}
              onChange={() => switchDisableLinkSharing()}
            />
            <label
              className="form-label form-check-label"
              htmlFor="disableLinkSharing"
            >
              {t('security_settings.enable_link_sharing')}
            </label>
          </div>
          {!setupStrategies.includes('local') && disableLinkSharing && (
            <div className="badge bg-warning text-dark">
              {t('security_settings.setup_is_not_yet_complete')}
            </div>
          )}
        </div>
      </div>
      <h4>{t('security_settings.all_share_links')}</h4>

      {shareLinks.length !== 0 ? (
        <>
          <Pager
            activePage={shareLinksActivePage}
            pagingHandler={getShareLinkList}
            totalLinks={totalshareLinks}
            limit={shareLinksPagingLimit}
          />
          <ShareLinkList
            shareLinks={shareLinks}
            onClickDeleteButton={deleteLinkById}
            isAdmin
          />
        </>
      ) : (
        <p className="text-center">{t('security_settings.No_share_links')}</p>
      )}

      <button
        className="pull-right btn btn-danger mt-2"
        disabled={shareLinks.length === 0}
        type="button"
        onClick={() => setIsDeleteConfirmModalShown(true)}
      >
        {t('security_settings.delete_all_share_links')}
      </button>

      <DeleteAllShareLinksModal
        isOpen={isDeleteConfirmModalShown}
        onClose={() => setIsDeleteConfirmModalShown(false)}
        onClickDeleteButton={deleteAllLinksButtonHandler}
      />
    </>
  );
};

/**
 * Wrapper component for using unstated
 */
const ShareLinkSettingWrapper = withUnstatedContainers(ShareLinkSetting, [
  AdminGeneralSecurityContainer,
]);

export default ShareLinkSettingWrapper;
