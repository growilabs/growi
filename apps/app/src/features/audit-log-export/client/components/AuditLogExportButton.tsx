import type { FC } from 'react';
import { useState, useCallback, useRef } from 'react';

import { useTranslation } from 'react-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

import { DateRangePicker } from '~/client/components/Admin/AuditLog/DateRangePicker';
import { SearchUsernameTypeahead } from '~/client/components/Admin/AuditLog/SearchUsernameTypeahead';
import { SelectActionDropdown } from '~/client/components/Admin/AuditLog/SelectActionDropdown';
import type { IClearable } from '~/client/interfaces/clearable';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { SupportedActionType } from '~/interfaces/activity';
import { useAuditLogAvailableActions } from '~/stores-universal/context';


export const AuditLogExportButton: FC = () => {
  const { t } = useTranslation('admin');
  const typeaheadRef = useRef<IClearable>(null);

  const { data: auditLogAvailableActionsData } = useAuditLogAvailableActions();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Filter states
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [actionMap, setActionMap] = useState(
    new Map<SupportedActionType, boolean>(
      auditLogAvailableActionsData != null ? auditLogAvailableActionsData.map(action => [action, true]) : [],
    ),
  );

  // Filter handlers
  const datePickerChangedHandler = useCallback((dateList: Date[] | null[]) => {
    setStartDate(dateList[0]);
    setEndDate(dateList[1]);
  }, []);

  const actionCheckboxChangedHandler = useCallback((action: SupportedActionType) => {
    actionMap.set(action, !actionMap.get(action));
    setActionMap(new Map(actionMap.entries()));
  }, [actionMap]);

  const multipleActionCheckboxChangedHandler = useCallback((actions: SupportedActionType[], isChecked: boolean) => {
    actions.forEach(action => actionMap.set(action, isChecked));
    setActionMap(new Map(actionMap.entries()));
  }, [actionMap]);

  const setUsernamesHandler = useCallback((usernames: string[]) => {
    setSelectedUsernames(usernames);
  }, []);

  const clearFiltersHandler = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
    setSelectedUsernames([]);
    typeaheadRef.current?.clear();

    if (auditLogAvailableActionsData != null) {
      setActionMap(new Map<SupportedActionType, boolean>(auditLogAvailableActionsData.map(action => [action, true])));
    }
  }, [auditLogAvailableActionsData]);

  // Modal handlers
  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Export logic
  const startAuditLogExport = async() => {
    setIsExporting(true);

    try {
      const selectedActionList = Array.from(actionMap.entries()).filter(v => v[1]).map(v => v[0]);

      const res = await fetch('/_api/v3/audit-log-bulk-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            users: selectedUsernames,
            actions: selectedActionList,
            dateFrom: startDate,
            dateTo: endDate,
          },
          format: 'json',
        }),
      });

      if (res.status === 204) {
        toastSuccess(t('audit_log_export.export_started'));
        toastSuccess(t('audit_log_export.notification_message'));
        closeModal();
      }
      else if (res.status === 409) {
        const data = await res.json();
        toastError(
          t('audit_log_export.duplicate_job_error', {
            createdAt: data.error?.duplicateJob?.createdAt,
          }),
        );
      }
      else {
        const data = await res.json();
        toastError(t('audit_log_export.export_failed', {
          message: data.error?.message ?? '',
        }));
      }
    }
    catch (err) {
      toastError(t('audit_log_export.request_failed', { error: err }));
    }
    finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-primary"
        onClick={openModal}
      >
        <span className="material-symbols-outlined">download</span> {t('audit_log_export.export')}
      </button>

      <Modal isOpen={isModalOpen} toggle={closeModal} size="lg">
        <ModalHeader toggle={closeModal}>
          {t('audit_log_export.export_audit_log')}
        </ModalHeader>
        <ModalBody>
          <div className="mb-4">
            <p className="text-muted">
              {t('audit_log_export.modal_description')}
            </p>
          </div>

          <div className="row g-3 mb-4">
            <div className="col-12">
              <div className="form-label">{t('audit_log_management.user')}</div>
              <SearchUsernameTypeahead
                ref={typeaheadRef}
                onChange={setUsernamesHandler}
              />
            </div>

            <div className="col-12">
              <div className="form-label">{t('audit_log_management.date')}</div>
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={datePickerChangedHandler}
              />
            </div>

            <div className="col-12">
              <div className="form-label">{t('audit_log_management.action')}</div>
              <SelectActionDropdown
                actionMap={actionMap}
                availableActions={auditLogAvailableActionsData || []}
                onChangeAction={actionCheckboxChangedHandler}
                onChangeMultipleAction={multipleActionCheckboxChangedHandler}
              />
            </div>
          </div>

          <div className="mb-3">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={clearFiltersHandler}
            >
              <span className="material-symbols-outlined">clear_all</span> {t('audit_log_management.clear')}
            </button>
          </div>

          <div className="alert alert-info">
            <span className="material-symbols-outlined me-2">info</span>
            {t('audit_log_export.notification_info')}
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={closeModal}
            disabled={isExporting}
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={startAuditLogExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <output className="spinner-border spinner-border-sm me-2" aria-hidden="true"></output>
                {t('audit_log_export.exporting')}
              </>
            ) : (
              <>
                <span className="material-symbols-outlined me-2">play_arrow</span>
                {t('audit_log_export.start_export')}
              </>
            )}
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
};
