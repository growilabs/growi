import React, { type JSX, useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { SocketEventName } from '~/interfaces/websocket';
import { auditLogEnabledAtom } from '~/states/server-configurations';

import { AuditLogDisableMode } from './AuditLog/AuditLogDisableMode';
import LabeledProgressBar from './Common/LabeledProgressBar';
import ReconnectControls from './ElasticsearchManagement/ReconnectControls';
import StatusTable from './ElasticsearchManagement/StatusTable';
import { useIndexManagement } from './hooks/useIndexManagement';

export const AuditLogIndexManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);
  const [hasUnsyncedEvents, setHasUnsyncedEvents] = useState(false);

  const onStatusSuccess = useCallback((data: unknown) => {
    setHasUnsyncedEvents(
      (data as { auditlogHasUnsyncedEvents?: boolean })
        .auditlogHasUnsyncedEvents ?? false,
    );
  }, []);

  const {
    isInitialized,
    isConnected,
    isConfigured,
    isReconnectingProcessing,
    isNormalizingProcessing,
    isRebuildingProcessing,
    isRebuildingCompleted,
    isNormalized,
    indicesData,
    aliasesData,
    rebuildTotal,
    rebuildCurrent,
    isErrorOccuredOnSearchService,
    isReconnectBtnEnabled,
    isNormalizeEnabled,
    isRebuildEnabled,
    reconnect,
    normalizeIndices,
    rebuildIndices,
  } = useIndexManagement({
    statusEndpoint: '/search/auditlog-indices',
    progressSocketEvent: SocketEventName.AddAuditlogProgress,
    finishSocketEvent: SocketEventName.FinishAddAuditlog,
    failedSocketEvent: SocketEventName.AuditlogRebuildingFailed,
    normalizationTimeoutMessage: t(
      'audit_log_index_management.rebuild_normalization_timeout',
    ),
    onStatusSuccess,
  });

  if (!auditLogEnabled) {
    return <AuditLogDisableMode />;
  }

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
          {t('audit_log_index_management.reconnect')}
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
            onClick={() =>
              normalizeIndices(
                t('audit_log_index_management.normalize_success'),
              )
            }
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
                header={
                  isRebuildingCompleted
                    ? t('audit_log_index_management.rebuild_progress_completed')
                    : t(
                        'audit_log_index_management.rebuild_progress_processing',
                      )
                }
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
            onClick={() =>
              rebuildIndices(t('audit_log_index_management.rebuild_requested'))
            }
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
