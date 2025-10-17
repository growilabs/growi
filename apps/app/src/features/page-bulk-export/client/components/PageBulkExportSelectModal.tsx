import { type JSX, useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns/format';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalHeader } from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useCurrentPagePath } from '~/states/page';
import { isPdfBulkExportEnabledAtom } from '~/states/server-configurations';

import { PageBulkExportFormat } from '../../interfaces/page-bulk-export';
import {
  usePageBulkExportSelectModalActions,
  usePageBulkExportSelectModalStatus,
} from '../states/modal';

const PageBulkExportSelectModalSubstance = (): JSX.Element => {
  const { t } = useTranslation();
  const { close } = usePageBulkExportSelectModalActions();
  const currentPagePath = useCurrentPagePath();
  const isPdfBulkExportEnabled = useAtomValue(isPdfBulkExportEnabledAtom);

  const [isRestartModalOpened, setIsRestartModalOpened] = useState(false);
  const [formatMemoForRestart, setFormatMemoForRestart] = useState<
    PageBulkExportFormat | undefined
  >(undefined);
  const [duplicateJobInfo, setDuplicateJobInfo] = useState<
    { createdAt: string } | undefined
  >(undefined);

  const startBulkExport = useCallback(
    async (format: PageBulkExportFormat) => {
      try {
        setFormatMemoForRestart(format);
        await apiv3Post('/page-bulk-export', { path: currentPagePath, format });
        toastSuccess(t('page_export.bulk_export_started'));
      } catch (e) {
        const errorCode = e?.[0].code ?? 'page_export.failed_to_export';
        if (errorCode === 'page_export.duplicate_bulk_export_job_error') {
          setDuplicateJobInfo(e[0].args.duplicateJob);
          setIsRestartModalOpened(true);
        } else {
          toastError(t(errorCode));
        }
      }
      close();
    },
    [close, currentPagePath, t],
  );

  const restartBulkExport = useCallback(async () => {
    if (formatMemoForRestart != null) {
      try {
        await apiv3Post('/page-bulk-export', {
          path: currentPagePath,
          format: formatMemoForRestart,
          restartJob: true,
        });
        toastSuccess(t('page_export.bulk_export_started'));
      } catch {
        toastError(t('page_export.failed_to_export'));
      }
      setIsRestartModalOpened(false);
    }
  }, [currentPagePath, formatMemoForRestart, t]);

  const handleCloseRestartModal = useCallback(() => {
    setIsRestartModalOpened(false);
  }, []);

  // Memoize format display text to prevent recalculation
  const formatDisplayText = useMemo(() => {
    if (!formatMemoForRestart) return '';
    return formatMemoForRestart === PageBulkExportFormat.md
      ? t('page_export.markdown')
      : 'PDF';
  }, [formatMemoForRestart, t]);

  // Memoize formatted date to prevent recalculation
  const formattedCreatedAt = useMemo(() => {
    if (!duplicateJobInfo?.createdAt) return '';
    return format(new Date(duplicateJobInfo.createdAt), 'MM/dd HH:mm');
  }, [duplicateJobInfo?.createdAt]);

  return (
    <>
      <ModalHeader tag="h4" toggle={close}>
        {t('page_export.bulk_export')}
      </ModalHeader>
      <ModalBody>
        <p className="card custom-card bg-warning-subtle pt-3 px-3">
          {t('page_export.bulk_export_download_explanation')}
          <span className="mt-3">
            <span className="material-symbols-outlined me-1">warning</span>
            {t('Warning')}
          </span>
          <ul className="mt-2">
            <li>{t('page_export.bulk_export_exec_time_warning')}</li>
            <li>{t('page_export.large_bulk_export_warning')}</li>
          </ul>
        </p>
        {t('page_export.choose_export_format')}:
        <div className="d-flex justify-content-center mt-3">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => startBulkExport(PageBulkExportFormat.md)}
          >
            {t('page_export.markdown')}
          </button>
          {isPdfBulkExportEnabled && (
            <button
              className="btn btn-primary ms-2"
              type="button"
              onClick={() => startBulkExport(PageBulkExportFormat.pdf)}
            >
              PDF
            </button>
          )}
        </div>
      </ModalBody>

      <Modal isOpen={isRestartModalOpened} toggle={handleCloseRestartModal}>
        <ModalHeader tag="h4" toggle={handleCloseRestartModal}>
          {t('page_export.export_in_progress')}
        </ModalHeader>
        <ModalBody>
          {t('page_export.export_in_progress_explanation')}
          <div className="text-danger">
            {t('page_export.export_cancel_warning')}:
          </div>
          {duplicateJobInfo && (
            <div className="my-1">
              <ul>
                {formatMemoForRestart && (
                  <li>
                    {t('page_export.format')}: {formatDisplayText}
                  </li>
                )}
                <li>
                  {t('page_export.started_on')}: {formattedCreatedAt}
                </li>
              </ul>
            </div>
          )}
          <div className="d-flex justify-content-center mt-3">
            <button
              className="btn btn-primary"
              type="button"
              onClick={restartBulkExport}
            >
              {t('page_export.restart')}
            </button>
          </div>
        </ModalBody>
      </Modal>
    </>
  );
};

const PageBulkExportSelectModal = (): JSX.Element => {
  const status = usePageBulkExportSelectModalStatus();

  return (
    <Modal isOpen={status?.isOpened ?? false} size="lg">
      {status?.isOpened && <PageBulkExportSelectModalSubstance />}
    </Modal>
  );
};

export default PageBulkExportSelectModal;
