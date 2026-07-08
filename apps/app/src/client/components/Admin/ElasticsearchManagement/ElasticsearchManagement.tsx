import { useTranslation } from 'next-i18next';

import { SocketEventName } from '~/interfaces/websocket';

import { useIndexManagement } from '../hooks/useIndexManagement';
import NormalizeIndicesControls from './NormalizeIndicesControls';
import RebuildIndexControls from './RebuildIndexControls';
import ReconnectControls from './ReconnectControls';
import StatusTable from './StatusTable';

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
    <>
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

      {/* Controls */}
      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('page_data_index_management.reconnect')}
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
          {t('page_data_index_management.normalize')}
        </div>
        <div className="col-md-6">
          <NormalizeIndicesControls
            isEnabled={isNormalizeEnabled}
            isProcessing={isNormalizingProcessing}
            buttonLabel={t('page_data_index_management.normalize_button')}
            description={t('page_data_index_management.normalize_description')}
            onNormalizingRequested={() =>
              normalizeIndices('Normalizing has succeeded')
            }
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('page_data_index_management.rebuild')}
        </div>
        <div className="col-md-6">
          <RebuildIndexControls
            isEnabled={isRebuildEnabled}
            isRebuildingProcessing={isRebuildingProcessing}
            isRebuildingCompleted={isRebuildingCompleted}
            currentCount={rebuildCurrent}
            totalCount={rebuildTotal}
            progressHeaderProcessing="Processing.."
            progressHeaderCompleted="Completed"
            buttonLabel={t('page_data_index_management.rebuild_button')}
            descriptionLines={[
              t('page_data_index_management.rebuild_description_1'),
              t('page_data_index_management.rebuild_description_2'),
            ]}
            onRebuildingRequested={() =>
              rebuildIndices('Rebuilding is requested')
            }
          />
        </div>
      </div>
    </>
  );
};

ElasticsearchManagement.propTypes = {};

export default ElasticsearchManagement;
