import React, {
  useCallback, useEffect, useState, type JSX,
} from 'react';

import { useTranslation } from 'react-i18next';


import { apiDelete } from '~/client/util/apiv1-client';
import { apiv3Get } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/stores/socket-io';

import LabeledProgressBar from './Common/LabeledProgressBar';
import ArchiveFilesTable from './ExportArchiveData/ArchiveFilesTable';
import SelectCollectionsModal from './ExportArchiveData/SelectCollectionsModal';


const IGNORED_COLLECTION_NAMES = [
  'sessions', 'rlflx', 'yjs-writings', 'transferkeys',
];

const ExportArchiveDataPage = (): JSX.Element => {
  const { data: socket } = useAdminSocket();
  const { t } = useTranslation('admin');

  const [collections, setCollections] = useState<any[]>([]);
  const [zipFileStats, setZipFileStats] = useState<any[]>([]);
  const [progressList, setProgressList] = useState<any[]>([]);
  const [isExportModalOpen, setExportModalOpen] = useState(false);
  const [isExporting, setExporting] = useState(false);
  const [isZipping, setZipping] = useState(false);
  const [isExported, setExported] = useState(false);

  const fetchData = useCallback(async() => {
    const [{ data: collectionsData }, { data: statusData }] = await Promise.all([
      apiv3Get<{collections: any[]}>('/mongo/collections', {}),
      apiv3Get<{status: { zipFileStats: any[], isExporting: boolean, progressList: any[] }}>('/export/status', {}),
    ]);

    // filter only not ignored collection names
    const filteredCollections = collectionsData.collections.filter((collectionName) => {
      return !IGNORED_COLLECTION_NAMES.includes(collectionName);
    });

    const { zipFileStats, isExporting, progressList } = statusData.status;
    setCollections(filteredCollections);
    setZipFileStats(zipFileStats);
    setExporting(isExporting);
    setProgressList(progressList);
  }, []);

  const setupWebsocketEventHandler = useCallback(() => {
    if (socket == null) {
      return () => {};
    }

    const onProgress = ({ currentCount, totalCount, progressList }) => {
      setExporting(true);
      setProgressList(progressList);
    };

    const onStartZipping = () => {
      setZipping(true);
    };

    const onTerminateForExport = ({ addedZipFileStat }) => {
      setExporting(false);
      setZipping(false);
      setExported(true);
      setZipFileStats(prev => prev.concat([addedZipFileStat]));

      toastSuccess(`New Archive Data '${addedZipFileStat.fileName}' is added`);
    };

    // Add listeners
    socket.on('admin:onProgressForExport', onProgress);
    socket.on('admin:onStartZippingForExport', onStartZipping);
    socket.on('admin:onTerminateForExport', onTerminateForExport);

    // Cleanup listeners
    return () => {
      socket.off('admin:onProgressForExport', onProgress);
      socket.off('admin:onStartZippingForExport', onStartZipping);
      socket.off('admin:onTerminateForExport', onTerminateForExport);
    };

  }, [socket]);

  const onZipFileStatRemove = useCallback(async(fileName) => {
    try {
      await apiDelete(`/v3/export/${fileName}`, {});

      setZipFileStats(prev => prev.filter(stat => stat.fileName !== fileName));

      toastSuccess(`Deleted ${fileName}`);
    }
    catch (err) {
      toastError(err);
    }
  }, []);

  const exportingRequestedHandler = useCallback(() => {}, []);

  const renderProgressBarsForCollections = useCallback(() => {
    const cols = progressList.map((progressData) => {
      const { collectionName, currentCount, totalCount } = progressData;
      return (
        <div className="col-md-6" key={collectionName}>
          <LabeledProgressBar
            header={collectionName}
            currentCount={currentCount}
            totalCount={totalCount}
          />
        </div>
      );
    });

    return <div className="row px-3">{cols}</div>;
  }, [progressList]);

  const renderProgressBarForZipping = useCallback(() => {
    const showZippingBar = isZipping || isExported;

    if (!showZippingBar) {
      return <></>;
    }

    return (
      <div className="row px-3">
        <div className="col-md-12" key="progressBarForZipping">
          <LabeledProgressBar
            header="Zip Files"
            currentCount={1}
            totalCount={1}
            isInProgress={isZipping}
          />
        </div>
      </div>
    );
  }, [isExported, isZipping]);

  useEffect(() => {
    fetchData();
    const cleanupWebsocket = setupWebsocketEventHandler();

    return () => {
      if (cleanupWebsocket) cleanupWebsocket();
    };
  }, [fetchData, setupWebsocketEventHandler]);

  const showExportingData = (isExported || isExporting) && (progressList != null);

  return (
    <div data-testid="admin-export-archive-data">
      <h2>{t('export_management.export_archive_data')}</h2>

      <button type="button" className="btn btn-outline-secondary" disabled={isExporting} onClick={() => setExportModalOpen(true)}>
        {t('export_management.create_new_archive_data')}
      </button>

      { showExportingData && (
        <div className="mt-5">
          <h3>{t('export_management.exporting_collection_list')}</h3>
          { renderProgressBarsForCollections() }
          { renderProgressBarForZipping() }
        </div>
      ) }

      <div className="mt-5">
        <h3 className="mb-3">{t('export_management.exported_data_list')}</h3>
        <ArchiveFilesTable
          zipFileStats={zipFileStats}
          onZipFileStatRemove={onZipFileStatRemove}
        />
      </div>

      <SelectCollectionsModal
        isOpen={isExportModalOpen}
        onExportingRequested={exportingRequestedHandler}
        onClose={() => setExportModalOpen(false)}
        collections={collections}
      />
    </div>
  );
};

export default ExportArchiveDataPage;
