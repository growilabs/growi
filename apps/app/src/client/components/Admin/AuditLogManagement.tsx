import type { FC } from 'react';
import React, { useState, useCallback, useRef } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import type { IClearable } from '~/client/interfaces/clearable';
import { toastError } from '~/client/util/toastr';
import type { SupportedActionType } from '~/interfaces/activity';
import { auditLogEnabledAtom, auditLogAvailableActionsAtom } from '~/states/server-configurations';
import { useSWRxActivity } from '~/stores/activity';

import PaginationWrapper from '../PaginationWrapper';

import { ActivityTable } from './AuditLog/ActivityTable';
import { AuditLogDisableMode } from './AuditLog/AuditLogDisableMode';
import { AuditLogSettings } from './AuditLog/AuditLogSettings';
import { DateRangePicker } from './AuditLog/DateRangePicker';
import { SearchUsernameTypeahead } from './AuditLog/SearchUsernameTypeahead';
import { SelectActionDropdown } from './AuditLog/SelectActionDropdown';

const formatDate = (date: Date | null) => {
  if (date == null) {
    return '';
  }
  return format(new Date(date), 'yyyy-MM-dd');
};

const PAGING_LIMIT = 10;

export const AuditLogManagement: FC = () => {
  const { t } = useTranslation('admin');

  const typeaheadRef = useRef<IClearable>(null);

  const auditLogAvailableActionsData = useAtomValue(auditLogAvailableActionsAtom);

  /*
   * State
   */
  const [isSettingPage, setIsSettingPage] = useState<boolean>(false);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);
  const [jumpPageNumber, setJumpPageNumber] = useState<number>(1);
  const offset = (activePageNumber - 1) * PAGING_LIMIT;
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [actionMap, setActionMap] = useState(
    new Map<SupportedActionType, boolean>(auditLogAvailableActionsData != null ? auditLogAvailableActionsData.map(action => [action, true]) : []),
  );

  /*
   * Fetch
   */
  const selectedDate = { startDate: formatDate(startDate), endDate: formatDate(endDate) };
  const selectedActionList = Array.from(actionMap.entries()).filter(v => v[1]).map(v => v[0]);
  const searchFilter = { actions: selectedActionList, dates: selectedDate, usernames: selectedUsernames };

  const { data: activityData, mutate: mutateActivity, error } = useSWRxActivity(PAGING_LIMIT, offset, searchFilter);
  const activityList = activityData?.docs != null ? activityData.docs : [];
  const totalActivityNum = activityData?.totalDocs != null ? activityData.totalDocs : 0;
  const totalPagingPages = activityData?.totalPages != null ? activityData.totalPages : 0;
  const isLoading = activityData === undefined && error == null;

  if (error != null) {
    toastError('Failed to get Audit Log');
  }

  const auditLogEnabled = useAtomValue(auditLogEnabledAtom);

  /*
   * Functions
   */
  const setActivePageHandler = useCallback((selectedPageNum: number) => {
    setActivePageNumber(selectedPageNum);
  }, []);

  const datePickerChangedHandler = useCallback((dateList: Date[] | null[]) => {
    setActivePageNumber(1);
    setStartDate(dateList[0]);
    setEndDate(dateList[1]);
  }, []);

  const actionCheckboxChangedHandler = useCallback((action: SupportedActionType) => {
    setActivePageNumber(1);
    actionMap.set(action, !actionMap.get(action));
    setActionMap(new Map(actionMap.entries()));
  }, [actionMap, setActionMap]);

  const multipleActionCheckboxChangedHandler = useCallback((actions: SupportedActionType[], isChecked) => {
    setActivePageNumber(1);
    actions.forEach(action => actionMap.set(action, isChecked));
    setActionMap(new Map(actionMap.entries()));
  }, [actionMap, setActionMap]);

  const setUsernamesHandler = useCallback((usernames: string[]) => {
    setActivePageNumber(1);
    setSelectedUsernames(usernames);
  }, []);

  const clearButtonPushedHandler = useCallback(() => {
    setActivePageNumber(1);
    setStartDate(null);
    setEndDate(null);
    setSelectedUsernames([]);
    typeaheadRef.current?.clear();

    if (auditLogAvailableActionsData != null) {
      setActionMap(new Map<SupportedActionType, boolean>(auditLogAvailableActionsData.map(action => [action, true])));
    }
  }, [setActivePageNumber, setStartDate, setEndDate, setSelectedUsernames, setActionMap, auditLogAvailableActionsData]);

  const reloadButtonPushedHandler = useCallback(() => {
    setActivePageNumber(1);
    mutateActivity();
  }, [mutateActivity]);

  const jumpPageInputChangeHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const inputNumber = Number(e.target.value);
    const isNan = Number.isNaN(inputNumber);

    if (!isNan) {
      // eslint-disable-next-line no-nested-ternary
      const jumpPageNumber = inputNumber > totalPagingPages ? totalPagingPages : inputNumber <= 0 ? activePageNumber : inputNumber;
      setJumpPageNumber(jumpPageNumber);
    }
    else {
      setJumpPageNumber(activePageNumber);
    }
  }, [totalPagingPages, activePageNumber, setJumpPageNumber]);

  const jumpPageInputKeyDownHandler = useCallback((e) => {
    if (e.key === 'Enter') {
      setActivePageNumber(jumpPageNumber);
    }
  }, [setActivePageNumber, jumpPageNumber]);

  const jumpPageButtonPushedHandler = useCallback(() => {
    setActivePageNumber(jumpPageNumber);
  }, [jumpPageNumber]);

  // eslint-disable-next-line max-len
  const activityCounter = `<b>${activityList.length === 0 ? 0 : offset + 1}</b> - <b>${(PAGING_LIMIT * activePageNumber) - (PAGING_LIMIT - activityList.length)}</b> of <b>${totalActivityNum}<b/>`;

  if (!auditLogEnabled) {
    return <AuditLogDisableMode />;
  }

  return (
    <div data-testid="admin-auditlog">
      <button type="button" className="btn btn-outline-secondary mb-4" onClick={() => setIsSettingPage(!isSettingPage)}>
        {
          isSettingPage
            ? <><span className="material-symbols-outlined">arrow_left_alt</span>{t('admin:audit_log_management.return')}</>
            : <><span className="material-symbols-outlined">settings</span>{t('admin:audit_log_management.settings')}</>
        }
      </button>

      <h2 className="admin-setting-header mb-3">
        <span>
          {isSettingPage ? t('audit_log_management.audit_log_settings') : t('audit_log_management.audit_log')}
        </span>
        { !isSettingPage && (
          <button type="button" className="btn btn-sm ms-auto grw-btn-reload" onClick={reloadButtonPushedHandler}>
            <span className="material-symbols-outlined">refresh</span>
          </button>
        )}
      </h2>

      {isSettingPage ? (
        <AuditLogSettings />
      ) : (
        <>
          <div className="row row-cols-lg-auto mb-3 g-3">
            <div className="col-12">
              <SearchUsernameTypeahead
                ref={typeaheadRef}
                onChange={setUsernamesHandler}
              />
            </div>

            <div className="col-12">
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={datePickerChangedHandler}
              />
            </div>

            <div className="col-12">
              <SelectActionDropdown
                actionMap={actionMap}
                availableActions={auditLogAvailableActionsData || []}
                onChangeAction={actionCheckboxChangedHandler}
                onChangeMultipleAction={multipleActionCheckboxChangedHandler}
              />
            </div>

            <div className="col-12">
              <button type="button" className="btn btn-link" onClick={clearButtonPushedHandler}>
                {t('admin:audit_log_management.clear')}
              </button>
            </div>
          </div>

          <p
            className="ms-2"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: activityCounter }}
          />

          { isLoading
            ? (
              <div className="text-muted text-center mb-5">
                <LoadingSpinner className="me-1 fs-3" />
              </div>
            )
            : (
              <ActivityTable activityList={activityList} />
            )
          }

          <div className="d-flex flex-row justify-content-center">
            <PaginationWrapper
              activePage={activePageNumber}
              changePage={setActivePageHandler}
              totalItemsCount={totalActivityNum}
              pagingLimit={PAGING_LIMIT}
              align="center"
              size="sm"
            />

            <div className="admin-audit-log ms-3">
              <label htmlFor="jumpPageInput" className="form-label me-1 text-secondary">Jump To Page</label>
              <input
                id="jumpPageInput"
                type="text"
                className="jump-page-input"
                onChange={jumpPageInputChangeHandler}
                onKeyDown={jumpPageInputKeyDownHandler}
              />
              <button className="btn btn-sm" type="button" onClick={jumpPageButtonPushedHandler}>
                <b>Go</b>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
