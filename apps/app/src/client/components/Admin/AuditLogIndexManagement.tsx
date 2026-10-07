import { type JSX, useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { SocketEventName } from '~/interfaces/websocket';
import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';
import { auditLogEnabledAtom } from '~/states/server-configurations';

import { IndexManagementSection } from './ElasticsearchManagement/IndexManagementSection';
import {
  type IndexManagementStatusResponse,
  useIndexManagement,
} from './hooks/useIndexManagement';

export const AuditLogIndexManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);
  const [hasUnsyncedEvents, setHasUnsyncedEvents] = useState(false);

  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();
  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

  const onStatusSuccess = useCallback((data: IndexManagementStatusResponse) => {
    setHasUnsyncedEvents(data.auditlogHasUnsyncedEvents ?? false);
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
    enabled: auditLogEnabled,
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
      >
        <p
          className="mb-0"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted translation markup
          dangerouslySetInnerHTML={{
            __html: t(
              isCloud
                ? 'audit_log_management.disable_mode_explanation_cloud'
                : 'audit_log_management.disable_mode_explanation',
            ),
          }}
        />
        {isCloud && (
          <a
            href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}
            className="btn btn-outline-secondary mt-2"
          >
            <span className="material-symbols-outlined me-1">share</span>
            {t('cloud_setting_management.to_cloud_settings')}
          </a>
        )}
      </div>
    );
  }

  return (
    <div data-testid="admin-audit-log-index">
      <IndexManagementSection
        statusTable={{
          isInitialized,
          isErrorOccuredOnSearchService,
          isConnected,
          isConfigured,
          isNormalized,
          indicesData,
          aliasesData,
        }}
        reconnect={{
          label: t('audit_log_index_management.reconnect'),
          isEnabled: isReconnectBtnEnabled,
          isProcessing: isReconnectingProcessing,
          onRequested: reconnect,
        }}
        normalize={{
          label: t('audit_log_index_management.normalize'),
          buttonLabel: t('audit_log_index_management.normalize_button'),
          description: t('audit_log_index_management.normalize_description'),
          isEnabled: isNormalizeEnabled,
          isProcessing: isNormalizingProcessing,
          onRequested: () =>
            normalizeIndices(t('audit_log_index_management.normalize_success')),
        }}
        rebuild={{
          label: t('audit_log_index_management.rebuild'),
          buttonLabel: t('audit_log_index_management.rebuild_button'),
          descriptionLines: [
            t('audit_log_index_management.rebuild_description_1'),
            t('audit_log_index_management.rebuild_description_2'),
          ],
          progressHeaderProcessing: t(
            'audit_log_index_management.rebuild_progress_processing',
          ),
          progressHeaderCompleted: t(
            'audit_log_index_management.rebuild_progress_completed',
          ),
          isEnabled: isRebuildEnabled,
          isProcessing: isRebuildingProcessing,
          isCompleted: isRebuildingCompleted,
          currentCount: rebuildCurrent,
          totalCount: rebuildTotal,
          onRequested: () =>
            rebuildIndices(t('audit_log_index_management.rebuild_requested')),
        }}
        extraContent={
          hasUnsyncedEvents && (
            <p className="form-text text-warning mt-2 mb-0">
              {t('audit_log_index_management.unsynced_events_warning')}
            </p>
          )
        }
      />
    </div>
  );
};
