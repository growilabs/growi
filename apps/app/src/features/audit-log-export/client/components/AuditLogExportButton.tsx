import type { FC } from 'react';

import { toastError, toastSuccess } from '~/client/util/toastr';

type Props = {
  filters: {
    users?: string[];
    actions?: string[];
    dateFrom?: Date | null;
    dateTo?: Date | null;
  };
};

export const AuditLogExportButton: FC<Props> = ({ filters }) => {
  const startAuditLogExport = async() => {
    try {
      const res = await fetch('/_api/v3/audit-log-bulk-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            users: filters.users,
            actions: filters.actions,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
          },
          format: 'json', // 現状は JSON 固定
        }),
      });

      if (res.status === 204) {
        toastSuccess('Audit-log export job started');
      }
      else if (res.status === 409) {
        const data = await res.json();
        toastError(
          `Duplicate job in progress (createdAt: ${data.error?.duplicateJob?.createdAt})`,
        );
      }
      else {
        const data = await res.json();
        toastError(`Failed to start export: ${data.error?.message ?? ''}`);
      }
    }
    catch (err) {
      toastError(`Request failed: ${err}`);
    }
  };

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-primary"
      onClick={startAuditLogExport}
    >
      <span className="material-symbols-outlined">download</span> Export
    </button>
  );
};
