import React, { type JSX, useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { apiv3Get, apiv3Post, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import {
  auditLogEnabledAtom,
  isSearchServiceReachableAtom,
} from '~/states/server-configurations';

import { AuditLogDisableMode } from './AuditLog/AuditLogDisableMode';
import ReconnectControls from './ElasticsearchManagement/ReconnectControls';
import StatusTable from './ElasticsearchManagement/StatusTable';

export const AuditLogIndexManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const isSearchServiceReachable = useAtomValue(isSearchServiceReachableAtom);
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);

  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isReconnectingProcessing, setIsReconnectingProcessing] =
    useState(false);
  const [isNormalizingProcessing, setIsNormalizingProcessing] = useState(false);
  const [isRebuildingProcessing, setIsRebuildingProcessing] = useState(false);

  const [isNormalized, setIsNormalized] = useState(false);
  const [indicesData, setIndicesData] = useState(null);
  const [aliasesData, setAliasesData] = useState(null);
  const [hasUnsyncedEvents, setHasUnsyncedEvents] = useState(false);

  const retrieveStatus = useCallback(async () => {
    try {
      const { data } = await apiv3Get('/search/auditlog-indices');
      const { info } = data;

      setIsConnected(true);
      setIsConfigured(true);
      setIsNormalized(info.isNormalized);
      setIndicesData(info.indices);
      setAliasesData(info.aliases);
      setHasUnsyncedEvents(data.auditlogHasUnsyncedEvents ?? false);
    } catch (errors: unknown) {
      setIsConnected(false);
      if (Array.isArray(errors)) {
        for (const error of errors) {
          if (error.code === 'search-service-unconfigured') {
            setIsConfigured(false);
          }
        }
      }
    } finally {
      setIsInitialized(true);
    }
  }, []);

  useEffect(() => {
    retrieveStatus();
  }, [retrieveStatus]);

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
      toastSuccess(t('audit_log_index_management.normalize_button'));
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
      toastSuccess(t('audit_log_index_management.rebuild_button'));
    } catch (e) {
      toastError(e);
    } finally {
      setIsRebuildingProcessing(false);
      await retrieveStatus();
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

  return (
    <div data-testid="admin-audit-log-index">
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
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('audit_log_index_management.rebuild')}
        </div>
        <div className="col-md-6">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isRebuildEnabled}
            onClick={rebuildIndices}
          >
            {isRebuildingProcessing && (
              <span
                className="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              />
            )}
            {t('audit_log_index_management.rebuild_button')}
          </button>
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
