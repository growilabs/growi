import React, { type JSX, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiDelete } from '~/client/util/apiv1-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/features/admin/states/socket-io';
import {
  useSWRxExportCollections,
  useSWRxExportStatus,
} from '~/stores/admin/export';

import LabeledProgressBar from './Common/LabeledProgressBar';
import ArchiveFilesTable from './ExportArchiveData/ArchiveFilesTable';
import SelectCollectionsModal from './ExportArchiveData/SelectCollectionsModal';

const ExportArchiveDataPage = (): JSX.Element => {
  const socket = useAdminSocket();
  const { t } = useTranslation('admin');

  const { data: collections } = useSWRxExportCollections();
  const { data: exportStatus, mutate: mutateExportStatus } =
    useSWRxExportStatus();

  // The exported-archive list is server state (derived from the filesystem by
  // GET /export/status), so it is read straight from SWR — never mirrored or
  // accumulated on the client. This is what makes duplicate rows impossible
  // (#11509): a completion event only revalidates, and the server stays the
  // single source of truth for how many archives exist.
  const zipFileStats = exportStatus?.zipFileStats ?? [];

  // Transient, high-frequency progress state driven by socket events. Seeded
  // from the persisted status so an export already running when the page opens
  // is reflected immediately.
  const [progressList, setProgressList] = useState<any[]>([]);
  const [isExportModalOpen, setExportModalOpen] = useState(false);
  const [isExporting, setExporting] = useState(false);
  const [isZipping, setZipping] = useState(false);
  const [isExported, setExported] = useState(false);

  useEffect(() => {
    if (exportStatus == null) {
      return;
    }
    setExporting(exportStatus.isExporting);
    setProgressList(exportStatus.progressList ?? []);
  }, [exportStatus]);

  const setupWebsocketEventHandler = useCallback(() => {
    if (socket == null) {
      return () => {};
    }

    const onProgress = ({ progressList }) => {
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

      // Revalidate against the server (the filesystem) instead of appending the
      // event payload locally. mutate() is idempotent, so the same completion
      // event processed more than once can never produce duplicate rows.
      mutateExportStatus();

      // A broken zip makes the server emit a null stat; guard the toast so the
      // listener never throws on it.
      if (addedZipFileStat != null) {
        toastSuccess(
          `New Archive Data '${addedZipFileStat.fileName}' is added`,
        );
      }
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
  }, [socket, mutateExportStatus]);

  const onZipFileStatRemove = useCallback(
    async (fileName) => {
      try {
        await apiDelete(`/v3/export/${fileName}`, {});

        // Re-sync with the server rather than filtering the local list by
        // fileName (which would drop every entry sharing that name).
        await mutateExportStatus();

        toastSuccess(`Deleted ${fileName}`);
      } catch (err) {
        toastError(err);
      }
    },
    [mutateExportStatus],
  );

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
    const cleanupWebsocket = setupWebsocketEventHandler();

    return () => {
      if (cleanupWebsocket) cleanupWebsocket();
    };
  }, [setupWebsocketEventHandler]);

  const showExportingData = (isExported || isExporting) && progressList != null;

  return (
    <div data-testid="admin-export-archive-data">
      <h2>{t('export_management.export_archive_data')}</h2>

      <button
        type="button"
        className="btn btn-outline-secondary"
        disabled={isExporting}
        onClick={() => setExportModalOpen(true)}
      >
        {t('export_management.create_new_archive_data')}
      </button>

      {showExportingData && (
        <div className="mt-5">
          <h3>{t('export_management.exporting_collection_list')}</h3>
          {renderProgressBarsForCollections()}
          {renderProgressBarForZipping()}
        </div>
      )}

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
        collections={collections ?? []}
      />
    </div>
  );
};

export default ExportArchiveDataPage;
