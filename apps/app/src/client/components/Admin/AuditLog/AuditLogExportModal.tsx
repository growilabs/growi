import { useCallback, useState } from 'react';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { SupportedActionType } from '~/interfaces/activity';
import { auditLogAvailableActionsAtom } from '~/states/server-configurations';

import { DateRangePicker } from './DateRangePicker';
import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';
import { SelectActionDropdown } from './SelectActionDropdown';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const AuditLogExportModalSubstance = ({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element => {
  const { t } = useTranslation('admin');

  const auditLogAvailableActionsData = useAtomValue(
    auditLogAvailableActionsAtom,
  );

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [_selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [actionMap, setActionMap] = useState(
    () =>
      new Map<SupportedActionType, boolean>(
        auditLogAvailableActionsData?.map((action) => [action, true]) ?? [],
      ),
  );
  const [isExporting, setIsExporting] = useState<boolean>(false);

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

  const exportHandler = useCallback(async () => {
    setIsExporting(true);
    try {
      const selectedActionList = Array.from(actionMap.entries())
        .filter((v) => v[1])
        .map((v) => v[0]);

      const filters: {
        actions?: SupportedActionType[];
        dateFrom?: Date;
        dateTo?: Date;
        // TODO: Add users filter after implementing username-to-userId conversion
      } = {};

      if (selectedActionList.length > 0) {
        filters.actions = selectedActionList;
      }
      if (startDate != null) {
        filters.dateFrom = startDate;
      }
      if (endDate != null) {
        filters.dateTo = endDate;
      }

      await apiv3Post('/audit-log-bulk-export', { filters });
      toastSuccess(t('audit_log_management.export_requested'));
      onClose();
    } catch {
      toastError(t('audit_log_management.export_failed'));
    } finally {
      setIsExporting(false);
    }
  }, [actionMap, startDate, endDate, t, onClose]);

  return (
    <>
      <ModalHeader tag="h4" toggle={onClose}>
        {t('audit_log_management.export_audit_log')}
      </ModalHeader>

      <ModalBody>
        <div className="mb-3">
          <div className="form-label">{t('audit_log_management.username')}</div>
          <SearchUsernameTypeahead onChange={setUsernamesHandler} />
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
    </>
  );
};

export const AuditLogExportModal = ({
  isOpen,
  onClose,
}: Props): JSX.Element => {
  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      {isOpen && <AuditLogExportModalSubstance onClose={onClose} />}
    </Modal>
  );
};
