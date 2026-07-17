import { useTranslation } from 'next-i18next';

import { SocketEventName } from '~/interfaces/websocket';

import { useIndexManagement } from '../hooks/useIndexManagement';
import { IndexManagementSection } from './IndexManagementSection';

const ElasticsearchManagement = (): JSX.Element => {
  const { t } = useTranslation('admin');

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
    statusEndpoint: '/search/indices',
    progressSocketEvent: SocketEventName.AddPageProgress,
    finishSocketEvent: SocketEventName.FinishAddPage,
    failedSocketEvent: SocketEventName.RebuildingFailed,
    normalizationTimeoutMessage: t(
      'page_data_index_management.rebuild_normalization_timeout',
    ),
  });

  return (
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
        label: t('page_data_index_management.reconnect'),
        isEnabled: isReconnectBtnEnabled,
        isProcessing: isReconnectingProcessing,
        onRequested: reconnect,
      }}
      normalize={{
        label: t('page_data_index_management.normalize'),
        buttonLabel: t('page_data_index_management.normalize_button'),
        description: t('page_data_index_management.normalize_description'),
        isEnabled: isNormalizeEnabled,
        isProcessing: isNormalizingProcessing,
        onRequested: () =>
          normalizeIndices(t('page_data_index_management.normalize_success')),
      }}
      rebuild={{
        label: t('page_data_index_management.rebuild'),
        buttonLabel: t('page_data_index_management.rebuild_button'),
        descriptionLines: [
          t('page_data_index_management.rebuild_description_1'),
          t('page_data_index_management.rebuild_description_2'),
        ],
        progressHeaderProcessing: t(
          'page_data_index_management.rebuild_progress_processing',
        ),
        progressHeaderCompleted: t(
          'page_data_index_management.rebuild_progress_completed',
        ),
        isEnabled: isRebuildEnabled,
        isProcessing: isRebuildingProcessing,
        isCompleted: isRebuildingCompleted,
        currentCount: rebuildCurrent,
        totalCount: rebuildTotal,
        onRequested: () =>
          rebuildIndices(t('page_data_index_management.rebuild_requested')),
      }}
    />
  );
};

ElasticsearchManagement.propTypes = {};

export default ElasticsearchManagement;
