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
    isRebuildingProcessing,
    isRebuildingCompleted,
    isNormalized,
    indicesData,
    aliasesData,
    isErrorOccuredOnSearchService,
    isReconnectBtnEnabled,
    reconnect,
    normalizeIndices,
    rebuildIndices,
  } = useIndexManagement({
    statusEndpoint: '/search/indices',
    normalizeRebuildEndpoint: '/search/indices',
    progressSocketEvent: SocketEventName.AddPageProgress,
    finishSocketEvent: SocketEventName.FinishAddPage,
    failedSocketEvent: SocketEventName.RebuildingFailed,
    normalizationTimeoutMessage: t(
      'full_text_search_management.rebuild_normalization_timeout',
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
          {t('full_text_search_management.normalize')}
        </div>
        <div className="col-md-6">
          <NormalizeIndicesControls
            isRebuildingProcessing={isRebuildingProcessing}
            isNormalized={isNormalized}
            onNormalizingRequested={() =>
              normalizeIndices('Normalizing has succeeded')
            }
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {t('full_text_search_management.rebuild')}
        </div>
        <div className="col-md-6">
          <RebuildIndexControls
            isRebuildingProcessing={isRebuildingProcessing}
            isRebuildingCompleted={isRebuildingCompleted}
            isNormalized={isNormalized}
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
