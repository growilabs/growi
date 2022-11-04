import React, {
  useCallback, useEffect, useState,
} from 'react';

import { useTranslation } from 'next-i18next';

import AdminGeneralSecurityContainer from '~/client/services/AdminGeneralSecurityContainer';
import { toastSuccess, toastError } from '~/client/util/apiNotification';
import { apiv3Delete } from '~/client/util/apiv3-client';

import PaginationWrapper from '../../PaginationWrapper';
import ShareLinkList from '../../ShareLink/ShareLinkList';
import { withUnstatedContainers } from '../../UnstatedUtils';

import DeleteAllShareLinksModal from './DeleteAllShareLinksModal';

type PagerProps = {
  activePage: number,
  pagingHandler: (page: number) => Promise<void>,
  totalLinks: number,
  limit: number,
}

type ShareLinkSettingProps = {
  adminGeneralSecurityContainer: AdminGeneralSecurityContainer,
}

const Pager = (props: PagerProps) => {
  const {
    activePage, pagingHandler, totalLinks, limit,
  } = props;

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
    shareLinks, shareLinksActivePage, totalshareLinks, shareLinksPagingLimit,
    disableLinkSharing, setupStrategies,
  } = adminGeneralSecurityContainer.state;
  const [isDeleteConfirmModalShown, setIsDeleteConfirmModalShown] = useState<boolean>();

  const getShareLinkList = useCallback(async(page: number) => {
    try {
      await adminGeneralSecurityContainer.retrieveShareLinksByPagingNum(page);
    }
    catch (err) {
      toastError(err);
    }
  }, [adminGeneralSecurityContainer]);

  // for Next routing
  useEffect(() => {
    getShareLinkList(1);
  }, [getShareLinkList]);

  const deleteAllLinksButtonHandler = useCallback(async() => {
    try {
      const res = await apiv3Delete('/share-links/all');
      const { deletedCount } = res.data;
      toastSuccess(t('toaster.remove_share_link', { count: deletedCount, ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
    getShareLinkList(1);
  }, [getShareLinkList, t]);

  const deleteLinkById = useCallback(async(shareLinkId: string) => {
    try {
      const res = await apiv3Delete(`/share-links/${shareLinkId}`);
      const { deletedShareLink } = res.data;
      toastSuccess(t('toaster.remove_share_link_success', { shareLinkId: deletedShareLink._id, ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
    getShareLinkList(shareLinksActivePage);
  }, [shareLinksActivePage, getShareLinkList, t]);

  const switchDisableLinkSharing = useCallback(async() => {
    try {
      await adminGeneralSecurityContainer.switchDisableLinkSharing();
      toastSuccess(t('toaster.switch_disable_link_sharing_success'));
    }
    catch (err) {
      toastError(err);
    }
  }, [adminGeneralSecurityContainer, t]);

  return (
    <>
      <div className="mb-3">
        <button
          className="pull-right btn btn-danger"
          disabled={shareLinks.length === 0}
          type="button"
          onClick={() => setIsDeleteConfirmModalShown(true)}
        >
          {t('security_settings.delete_all_share_links')}
        </button>
        <h2 className="alert-anchor border-bottom">{t('security_settings.share_link_management')}</h2>
      </div>
      <h4>{t('security_settings.share_link_rights')}</h4>
      <div className="row mb-5">
        <div className="col-6 offset-3">
          <div className="custom-control custom-switch custom-checkbox-success">
            <input
              type="checkbox"
              className="custom-control-input"
              id="disableLinkSharing"
              checked={!disableLinkSharing}
              onChange={() => switchDisableLinkSharing()}
            />
            <label className="custom-control-label" htmlFor="disableLinkSharing">
              {t('security_settings.enable_link_sharing')}
            </label>
          </div>
          {!setupStrategies.includes('local') && disableLinkSharing && (
            <div className="badge badge-warning">{t('security_settings.setup_is_not_yet_complete')}</div>
          )}
        </div>
      </div>
      <h4>{t('security_settings.all_share_links')}</h4>
      <Pager
        activePage={shareLinksActivePage}
        pagingHandler={getShareLinkList}
        totalLinks={totalshareLinks}
        limit={shareLinksPagingLimit}
      />

      {(shareLinks.length !== 0) ? (
        <ShareLinkList
          shareLinks={shareLinks}
          onClickDeleteButton={deleteLinkById}
          isAdmin
        />
      )
        : (<p className="text-center">{t('security_settings.No_share_links')}</p>
        )
      }

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
const ShareLinkSettingWrapper = withUnstatedContainers(ShareLinkSetting, [AdminGeneralSecurityContainer]);

export default ShareLinkSettingWrapper;
