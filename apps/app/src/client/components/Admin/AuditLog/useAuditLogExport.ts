import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { IAuditLogBulkExportFilters } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';

export const useAuditLogExport = (
  buildFilters: () => IAuditLogBulkExportFilters,
  onClose: () => void,
) => {
  const { t } = useTranslation('admin');

  const [isExporting, setIsExporting] = useState(false);
  const [isDuplicateConfirmOpen, setIsDuplicateConfirmOpen] = useState(false);

  const exportHandler = useCallback(async () => {
    setIsExporting(true);
    try {
      const filters = buildFilters();
      await apiv3Post('/audit-log-bulk-export', { filters });
      toastSuccess(t('audit_log_management.export_requested'));
      onClose();
    } catch (errs) {
      const isDuplicate =
        Array.isArray(errs) &&
        errs.some(
          (e) => e.code === 'audit_log_bulk_export.duplicate_export_job_error',
        );

      if (isDuplicate) {
        setIsDuplicateConfirmOpen(true);
      } else {
        toastError(t('audit_log_management.export_failed'));
      }
    } finally {
      setIsExporting(false);
    }
  }, [buildFilters, t, onClose]);

  const restartExportHandler = useCallback(async () => {
    setIsDuplicateConfirmOpen(false);
    setIsExporting(true);
    try {
      const filters = buildFilters();
      await apiv3Post('/audit-log-bulk-export', { filters, restartJob: true });
      toastSuccess(t('audit_log_management.export_requested'));
      onClose();
    } catch {
      toastError(t('audit_log_management.export_failed'));
    } finally {
      setIsExporting(false);
    }
  }, [buildFilters, t, onClose]);

  const closeDuplicateConfirm = useCallback(() => {
    setIsDuplicateConfirmOpen(false);
  }, []);

  return {
    isExporting,
    isDuplicateConfirmOpen,
    exportHandler,
    restartExportHandler,
    closeDuplicateConfirm,
  };
};
