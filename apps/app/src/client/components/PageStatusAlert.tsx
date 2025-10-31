import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { useCurrentPageData, useRemoteRevisionId, useRemoteRevisionLastUpdateUser } from '~/states/page';
import { useEditorMode } from '~/states/ui/editor';
import { usePageStatusAlertStatus } from '~/states/ui/modal/page-status-alert';

import { Username } from '../../components/User/Username';

import styles from './PageStatusAlert.module.scss';

export const PageStatusAlert = (): JSX.Element => {
  const { t } = useTranslation();

  const { editorMode } = useEditorMode();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const pageStatusAlertData = usePageStatusAlertStatus();
  const remoteRevisionId = useRemoteRevisionId();
  const remoteRevisionLastUpdateUser = useRemoteRevisionLastUpdateUser();
  const pageData = useCurrentPageData();

  const onClickRefreshPage = useCallback(() => {
    pageStatusAlertData?.onRefleshPage?.();
  }, [pageStatusAlertData]);

  const onClickResolveConflict = useCallback(() => {
    pageStatusAlertData?.onResolveConflict?.();
  }, [pageStatusAlertData]);

  const hasResolveConflictHandler = pageStatusAlertData?.onResolveConflict != null;
  const hasRefreshPageHandler = pageStatusAlertData?.onRefleshPage != null;

  const currentRevisionId = pageData?.revision?._id;
  const isRevisionOutdated = (currentRevisionId != null || remoteRevisionId != null) && currentRevisionId !== remoteRevisionId;

  if (!pageStatusAlertData?.isOpen || !!isGuestUser || !!isReadOnlyUser || !isRevisionOutdated) {
    return <></>;
  }

  if (editorMode === pageStatusAlertData?.hideEditorMode) {
    return <></>;
  }

  return (
    <div className={`${styles['grw-page-status-alert']} card fixed-bottom animated fadeInUp faster text-bg-warning`}>
      <div className="card-body">
        <p className="card-text grw-card-label-container">
          {hasResolveConflictHandler
            ? <>{t('modal_resolve_conflict.file_conflicting_with_newer_remote')}</>
            : <><Username user={remoteRevisionLastUpdateUser} /> {t('edited this page')}</>
          }
        </p>
        <p className="card-text grw-card-btn-container">
          {hasRefreshPageHandler && (
            <button type="button" onClick={onClickRefreshPage} className="btn btn-outline-white">
              <span className="material-symbols-outlined">refresh</span>{t('Load latest')}
            </button>
          )}
          {hasResolveConflictHandler && (
            <button type="button" onClick={onClickResolveConflict} className="btn btn-outline-white">
              <span className="material-symbols-outlined">description</span>{t('modal_resolve_conflict.resolve_conflict')}
            </button>
          )}
        </p>
      </div>
    </div>
  );
};
