import React, { type JSX, useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { apiv3Get, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/features/admin/states/socket-io';
import { SocketEventName } from '~/interfaces/websocket';
import {
  auditLogEnabledAtom,
  isSearchServiceReachableAtom,
} from '~/states/server-configurations';

import { AuditLogDisableMode } from './AuditLog/AuditLogDisableMode';
import LabeledProgressBar from './Common/LabeledProgressBar';
import ReconnectControls from './ElasticsearchManagement/ReconnectControls';
import StatusTable from './ElasticsearchManagement/StatusTable';

export const AuditLogIndexManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const isSearchServiceReachable = useAtomValue(isSearchServiceReachableAtom);
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);
  const socket = useAdminSocket();

  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isReconnectingProcessing, setIsReconnectingProcessing] =
    useState(false);
  const [isNormalizingProcessing, setIsNormalizingProcessing] = useState(false);
  const [isRebuildingProcessing, setIsRebuildingProcessing] = useState(false);
  const [isRebuildingCompleted, setIsRebuildingCompleted] = useState(false);

  const [isNormalized, setIsNormalized] = useState(false);
  const [indicesData, setIndicesData] = useState(null);
  const [aliasesData, setAliasesData] = useState(null);
  const [hasUnsyncedEvents, setHasUnsyncedEvents] = useState(false);
  const [rebuildTotal, setRebuildTotal] = useState(0);
  const [rebuildCurrent, setRebuildCurrent] = useState(0);

  const retrieveStatus = useCallback(async (): Promise<boolean> => {
    try {
      const { data } = await apiv3Get('/search/auditlog-indices');
      const { info } = data;

      setIsConnected(true);
      setIsConfigured(true);
      setIsNormalized(info.isNormalized);
      setIndicesData(info.indices);
      setAliasesData(info.aliases);
      setHasUnsyncedEvents(data.auditlogHasUnsyncedEvents ?? false);
      return info.isNormalized;
    } catch (errors: unknown) {
      setIsConnected(false);
      if (Array.isArray(errors)) {
        for (const error of errors) {
          if (error.code === 'search-service-unconfigured') {
            setIsConfigured(false);
          }
        }
      }
      return false;
    } finally {
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    retrieveStatus();
  }, [retrieveStatus]);

  useEffect(() => {
    if (socket == null) {
      return;
    }

    socket.on(SocketEventName.AddPageProgress, (data) => {
      setIsRebuildingProcessing(true);
      setRebuildTotal(data.totalCount);
      setRebuildCurrent(data.count);
    });

    socket.on(SocketEventName.FinishAddPage, async (data) => {
      setRebuildTotal(data.totalCount);
      setRebuildCurrent(data.count);

      let retryCount = 0;
      const maxRetries = 5;
      const retryDelay = 500;

      const retrieveStatusWithRetry = async () => {
        const isNormalizedResult = await retrieveStatus();
        if (!isNormalizedResult && retryCount < maxRetries) {
          retryCount++;
          setTimeout(retrieveStatusWithRetry, retryDelay);
        }
      };

      await retrieveStatusWithRetry();
      setIsRebuildingProcessing(false);
      setIsRebuildingCompleted(true);
    });

    socket.on(SocketEventName.RebuildingFailed, (data) => {
      toastError(new Error(data.error));
    });

    return () => {
      socket.off(SocketEventName.AddPageProgress);
      socket.off(SocketEventName.FinishAddPage);
      socket.off(SocketEventName.RebuildingFailed);
    };
  }, [retrieveStatus, socket]);

  if (!auditLogEnabled) {
    return <AuditLogDisableMode />;
  }

  const reconnect = async () => {
    setIsReconnectingProcessing(true);
    try {
      await apiv3Post('/search/connection');
    } catch (e) {
      toastError(e);
      setIsReconnectingProcessing(false);
      return;
    }
    window.location.reload();
  };

  const normalizeIndices = async () => {
    setIsNormalizingProcessing(true);
    try {
      await apiv3Put('/search/auditlog-indices', { operation: 'normalize' });
      toastSuccess(t('audit_log_index_management.normalize_success'));
    } catch (e) {
      toastError(e);
    } finally {
      setIsNormalizingProcessing(false);
      await retrieveStatus();
    }
  };

  const rebuildIndices = async () => {
    setIsRebuildingProcessing(true);
    try {
      await apiv3Put('/search/auditlog-indices', { operation: 'rebuild' });
      toastSuccess(t('audit_log_index_management.rebuild_requested'));
    } catch (e) {
      toastError(e);
      setIsRebuildingProcessing(false);
    }
  };

  const isErrorOccuredOnSearchService = !isSearchServiceReachable;

  const isReconnectBtnEnabled =
    !isReconnectingProcessing &&
    (!isInitialized || !isConnected || isErrorOccuredOnSearchService);

  const isNormalizeEnabled =
    !isNormalized &&
    !isNormalizingProcessing &&
    !isRebuildingProcessing &&
    isConnected;
  const isRebuildEnabled =
    isNormalized &&
    !isRebuildingProcessing &&
    !isNormalizingProcessing &&
    isConnected;

  const showProgressBar = isRebuildingProcessing || isRebuildingCompleted;

  return (
    <div data-testid="admin-audit-log-index">
      <h2 className="mb-4">
        {t('audit_log_index_management.elasticsearch_management')}
      </h2>

      <div className="row">
        <div className="col-md-12">
          <StatusTable
            isInitialized={isInitialized}
            isErrorOccuredOnSearchService={isErrorOccuredOnSearchService}
            isConnected={isConnected}
            isConfigured={isConfigured}
            isNormalized={isNormalized}
            indicesData={indicesData}
            aliasesData={aliasesData}
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('full_text_search_management.reconnect')}
        </div>
        <div className="col-md-6">
          <ReconnectControls
            isEnabled={isReconnectBtnEnabled}
            isProcessing={isReconnectingProcessing}
            onReconnectingRequested={reconnect}
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('audit_log_index_management.normalize')}
        </div>
        <div className="col-md-6">
          <button
            type="button"
            className={`btn ${isNormalizeEnabled ? 'btn-outline-info' : 'btn-outline-secondary'}`}
            disabled={!isNormalizeEnabled}
            onClick={normalizeIndices}
          >
            {isNormalizingProcessing && (
              <span
                className="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              />
            )}
            {t('audit_log_index_management.normalize_button')}
          </button>
          <p className="form-text text-muted">
            {t('audit_log_index_management.normalize_description')}
          </p>
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('audit_log_index_management.rebuild')}
        </div>
        <div className="col-md-6">
          {showProgressBar && (
            <div className="mb-3">
              <LabeledProgressBar
                header={isRebuildingCompleted ? 'Completed' : 'Processing..'}
                currentCount={rebuildCurrent}
                totalCount={rebuildTotal}
                isInProgress={isRebuildingProcessing}
              />
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isRebuildEnabled}
            onClick={rebuildIndices}
          >
            {t('audit_log_index_management.rebuild_button')}
          </button>
          <p className="form-text text-muted">
            {t('audit_log_index_management.rebuild_description_1')}
            <br />
            {t('audit_log_index_management.rebuild_description_2')}
          </p>
          {hasUnsyncedEvents && (
            <p className="form-text text-warning mt-2 mb-0">
              {t('audit_log_index_management.unsynced_events_warning')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
