import type { JSX, ReactNode } from 'react';

import NormalizeIndicesControls from './NormalizeIndicesControls';
import RebuildIndexControls from './RebuildIndexControls';
import ReconnectControls from './ReconnectControls';
import StatusTable from './StatusTable';

type StatusTableSectionProps = {
  isInitialized: boolean;
  isErrorOccuredOnSearchService: boolean;
  isConnected: boolean;
  isConfigured: boolean;
  isNormalized: boolean;
  indicesData: unknown;
  aliasesData: unknown;
};

type ReconnectSectionProps = {
  label: string;
  isEnabled?: boolean;
  isProcessing?: boolean;
  onRequested: () => void;
};

type NormalizeSectionProps = {
  label: string;
  buttonLabel: string;
  description: string;
  isEnabled: boolean;
  isProcessing: boolean;
  onRequested: () => void;
};

type RebuildSectionProps = {
  label: string;
  buttonLabel: string;
  descriptionLines: string[];
  progressHeaderProcessing: string;
  progressHeaderCompleted: string;
  isEnabled: boolean;
  isProcessing: boolean;
  isCompleted: boolean;
  currentCount: number;
  totalCount: number;
  onRequested: () => void;
};

type Props = {
  statusTable: StatusTableSectionProps;
  reconnect: ReconnectSectionProps;
  normalize: NormalizeSectionProps;
  rebuild: RebuildSectionProps;
  // Rendered after the rebuild controls (e.g. audit log's unsynced-events warning).
  extraContent?: ReactNode;
};

// Shared row/col layout for the reconnect/normalize/rebuild controls -- used
// by both the page-data and audit-log Elasticsearch index management sections.
export const IndexManagementSection = (props: Props): JSX.Element => {
  const { statusTable, reconnect, normalize, rebuild, extraContent } = props;

  return (
    <>
      <div className="row">
        <div className="col-md-12">
          <StatusTable {...statusTable} />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {reconnect.label}
        </div>
        <div className="col-md-6">
          <ReconnectControls
            isEnabled={reconnect.isEnabled}
            isProcessing={reconnect.isProcessing}
            onReconnectingRequested={reconnect.onRequested}
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {normalize.label}
        </div>
        <div className="col-md-6">
          <NormalizeIndicesControls
            isEnabled={normalize.isEnabled}
            isProcessing={normalize.isProcessing}
            buttonLabel={normalize.buttonLabel}
            description={normalize.description}
            onNormalizingRequested={normalize.onRequested}
          />
        </div>
      </div>

      <hr />

      <div className="row">
        <div className="col-md-3 col-form-label text-start text-md-end">
          {rebuild.label}
        </div>
        <div className="col-md-6">
          <RebuildIndexControls
            isEnabled={rebuild.isEnabled}
            isRebuildingProcessing={rebuild.isProcessing}
            isRebuildingCompleted={rebuild.isCompleted}
            currentCount={rebuild.currentCount}
            totalCount={rebuild.totalCount}
            progressHeaderProcessing={rebuild.progressHeaderProcessing}
            progressHeaderCompleted={rebuild.progressHeaderCompleted}
            buttonLabel={rebuild.buttonLabel}
            descriptionLines={rebuild.descriptionLines}
            onRebuildingRequested={rebuild.onRequested}
          />
          {extraContent}
        </div>
      </div>
    </>
  );
};
