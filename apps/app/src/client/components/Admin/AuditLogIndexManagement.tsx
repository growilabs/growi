import React, { type JSX, useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { SocketEventName } from '~/interfaces/websocket';
import { auditLogEnabledAtom } from '~/states/server-configurations';

import NormalizeIndicesControls from './ElasticsearchManagement/NormalizeIndicesControls';
import RebuildIndexControls from './ElasticsearchManagement/RebuildIndexControls';
import ReconnectControls from './ElasticsearchManagement/ReconnectControls';
import StatusTable from './ElasticsearchManagement/StatusTable';
import {
  type IndexManagementStatusResponse,
  useIndexManagement,
} from './hooks/useIndexManagement';

export const AuditLogIndexManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);
  const [hasUnsyncedEvents, setHasUnsyncedEvents] = useState(false);

  const onStatusSuccess = useCallback((data: IndexManagementStatusResponse) => {
    setHasUnsyncedEvents(data.auditlogHasUnsyncedEvents);
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
    return (
      <div
        className="alert alert-secondary mb-0"
        data-testid="admin-audit-log-index-disabled"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted translation markup
        dangerouslySetInnerHTML={{
          __html: t('audit_log_management.disable_mode_explanation'),
        }}
      />
    );
  }

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
          <NormalizeIndicesControls
            isEnabled={isNormalizeEnabled}
            isProcessing={isNormalizingProcessing}
            buttonLabel={t('audit_log_index_management.normalize_button')}
            description={t('audit_log_index_management.normalize_description')}
            onNormalizingRequested={() =>
              normalizeIndices(
                t('audit_log_index_management.normalize_success'),
              )
            }
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('audit_log_index_management.rebuild')}
        </div>
        <div className="col-md-6">
          <RebuildIndexControls
            isEnabled={isRebuildEnabled}
            isRebuildingProcessing={isRebuildingProcessing}
            isRebuildingCompleted={isRebuildingCompleted}
            currentCount={rebuildCurrent}
            totalCount={rebuildTotal}
            progressHeaderProcessing={t(
              'audit_log_index_management.rebuild_progress_processing',
            )}
            progressHeaderCompleted={t(
              'audit_log_index_management.rebuild_progress_completed',
            )}
            buttonLabel={t('audit_log_index_management.rebuild_button')}
            descriptionLines={[
              t('audit_log_index_management.rebuild_description_1'),
              t('audit_log_index_management.rebuild_description_2'),
            ]}
            onRebuildingRequested={() =>
              rebuildIndices(t('audit_log_index_management.rebuild_requested'))
            }
          />
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
