import { useCallback, useState } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import type { IAuditLogBulkExportRequestFilters } from '~/features/audit-log-bulk-export/interfaces/audit-log-bulk-export';
import type { SupportedActionType } from '~/interfaces/activity';
import { auditLogAvailableActionsAtom } from '~/states/server-configurations';

import { DateRangePicker } from './DateRangePicker';
import { DuplicateExportConfirmModal } from './DuplicateExportConfirmModal';
import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';
import { SelectActionDropdown } from './SelectActionDropdown';
import { useAuditLogExport } from './useAuditLogExport';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialStartDate?: Date | null;
  initialEndDate?: Date | null;
  initialSelectedUsernames?: string[];
  initialActionMap?: Map<SupportedActionType, boolean>;
};

const AuditLogExportModalSubstance = ({
  onClose,
  initialStartDate,
  initialEndDate,
  initialSelectedUsernames,
  initialActionMap,
}: {
  onClose: () => void;
  initialStartDate?: Date | null;
  initialEndDate?: Date | null;
  initialSelectedUsernames?: string[];
  initialActionMap?: Map<SupportedActionType, boolean>;
}): JSX.Element => {
  const { t } = useTranslation('admin');

  const auditLogAvailableActionsData = useAtomValue(
    auditLogAvailableActionsAtom,
  );

  const [startDate, setStartDate] = useState<Date | null>(
    initialStartDate ?? null,
  );
  const [endDate, setEndDate] = useState<Date | null>(initialEndDate ?? null);
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>(
    initialSelectedUsernames ?? [],
  );
  const [actionMap, setActionMap] = useState(() =>
    initialActionMap != null
      ? new Map(initialActionMap)
      : new Map<SupportedActionType, boolean>(
          auditLogAvailableActionsData?.map((action) => [action, true]) ?? [],
        ),
  );

  const datePickerChangedHandler = useCallback((dateList: Date[] | null[]) => {
    setStartDate(dateList[0]);
    setEndDate(dateList[1]);
  }, []);

  const actionCheckboxChangedHandler = useCallback(
    (action: SupportedActionType) => {
      setActionMap((prev) => {
        const next = new Map(prev);
        next.set(action, !next.get(action));
        return next;
      });
    },
    [],
  );

  const multipleActionCheckboxChangedHandler = useCallback(
    (actions: SupportedActionType[], isChecked: boolean) => {
      setActionMap((prev) => {
        const next = new Map(prev);
        actions.forEach((action) => {
          next.set(action, isChecked);
        });
        return next;
      });
    },
    [],
  );

  const setUsernamesHandler = useCallback((usernames: string[]) => {
    setSelectedUsernames(usernames);
  }, []);

  const buildFilters = useCallback(() => {
    const selectedActionList = Array.from(actionMap.entries())
      .filter((v) => v[1])
      .map((v) => v[0]);

    const filters: IAuditLogBulkExportRequestFilters = {};

    if (selectedUsernames.length > 0) {
      filters.usernames = selectedUsernames;
    }
    if (selectedActionList.length > 0) {
      filters.actions = selectedActionList;
    }
    if (startDate != null) {
      filters.dateFrom = startDate;
    }
    if (endDate != null) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      filters.dateTo = endOfDay;
    }

    return filters;
  }, [actionMap, selectedUsernames, startDate, endDate]);

  const {
    isExporting,
    isDuplicateConfirmOpen,
    exportHandler,
    restartExportHandler,
    closeDuplicateConfirm,
  } = useAuditLogExport(buildFilters, onClose);

  return (
    <>
      <ModalHeader tag="h4" toggle={onClose}>
        {t('audit_log_management.export_audit_log')}
      </ModalHeader>

      <ModalBody>
        <div className="mb-3">
          <div className="form-label">{t('audit_log_management.username')}</div>
          <SearchUsernameTypeahead
            onChange={setUsernamesHandler}
            initialUsernames={initialSelectedUsernames}
          />
        </div>

        <div className="mb-3">
          <div className="form-label">{t('audit_log_management.date')}</div>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={datePickerChangedHandler}
          />
        </div>

        <div className="mb-3">
          <div className="form-label">{t('audit_log_management.action')}</div>
          <SelectActionDropdown
            actionMap={actionMap}
            availableActions={auditLogAvailableActionsData || []}
            onChangeAction={actionCheckboxChangedHandler}
            onChangeMultipleAction={multipleActionCheckboxChangedHandler}
          />
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onClose}
        >
          {t('export_management.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={exportHandler}
          disabled={isExporting}
        >
          {isExporting ? (
            <LoadingSpinner className="me-1 fs-3" />
          ) : (
            <span className="material-symbols-outlined me-1">download</span>
          )}
          {t('audit_log_management.export')}
        </button>
      </ModalFooter>

      <DuplicateExportConfirmModal
        isOpen={isDuplicateConfirmOpen}
        onClose={closeDuplicateConfirm}
        onRestart={restartExportHandler}
      />
    </>
  );
};

export const AuditLogExportModal = ({
  isOpen,
  onClose,
  initialStartDate,
  initialEndDate,
  initialSelectedUsernames,
  initialActionMap,
}: Props): JSX.Element => {
  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      {isOpen && (
        <AuditLogExportModalSubstance
          onClose={onClose}
          initialStartDate={initialStartDate}
          initialEndDate={initialEndDate}
          initialSelectedUsernames={initialSelectedUsernames}
          initialActionMap={initialActionMap}
        />
      )}
    </Modal>
  );
};
