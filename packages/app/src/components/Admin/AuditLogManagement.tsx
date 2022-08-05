import React, {
  FC, useState, useCallback, useRef,
} from 'react';

import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { IClearable } from '~/client/interfaces/clearable';
import { toastError } from '~/client/util/apiNotification';
import { SupportedActionType } from '~/interfaces/activity';
import { useSWRxActivity } from '~/stores/activity';
import { useAuditLogEnabled, useAuditLogAvailableActions } from '~/stores/context';

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
  const { t } = useTranslation();

  const typeaheadRef = useRef<IClearable>(null);

  const { data: auditLogAvailableActionsData } = useAuditLogAvailableActions();

  /*
   * State
   */
  const [isSettingPage, setIsSettingPage] = useState<boolean>(false);
  const [activePage, setActivePage] = useState<number>(1);
  const offset = (activePage - 1) * PAGING_LIMIT;
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
  const isLoading = activityData === undefined && error == null;

  if (error != null) {
    toastError('Failed to get Audit Log');
  }

  const { data: auditLogEnabled } = useAuditLogEnabled();

  /*
   * Functions
   */
  const setActivePageHandler = useCallback((selectedPageNum: number) => {
    setActivePage(selectedPageNum);
  }, []);

  const datePickerChangedHandler = useCallback((dateList: Date[] | null[]) => {
    setActivePage(1);
    setStartDate(dateList[0]);
    setEndDate(dateList[1]);
  }, []);

  const actionCheckboxChangedHandler = useCallback((action: SupportedActionType) => {
    setActivePage(1);
    actionMap.set(action, !actionMap.get(action));
    setActionMap(new Map(actionMap.entries()));
  }, [actionMap, setActionMap]);

  const multipleActionCheckboxChangedHandler = useCallback((actions: SupportedActionType[], isChecked) => {
    setActivePage(1);
    actions.forEach(action => actionMap.set(action, isChecked));
    setActionMap(new Map(actionMap.entries()));
  }, [actionMap, setActionMap]);

  const setUsernamesHandler = useCallback((usernames: string[]) => {
    setActivePage(1);
    setSelectedUsernames(usernames);
  }, []);

  const clearButtonPushedHandler = useCallback(() => {
    setActivePage(1);
    setStartDate(null);
    setEndDate(null);
    setSelectedUsernames([]);
    typeaheadRef.current?.clear();

    if (auditLogAvailableActionsData != null) {
      setActionMap(new Map<SupportedActionType, boolean>(auditLogAvailableActionsData.map(action => [action, true])));
    }
  }, [setActivePage, setStartDate, setEndDate, setSelectedUsernames, setActionMap, auditLogAvailableActionsData]);

  const reloadButtonPushedHandler = useCallback(() => {
    setActivePage(1);
    mutateActivity();
  }, [mutateActivity]);

  // eslint-disable-next-line max-len
  const activityCounter = `<b>${activityList.length === 0 ? 0 : offset + 1}</b> - <b>${(PAGING_LIMIT * activePage) - (PAGING_LIMIT - activityList.length)}</b> of <b>${totalActivityNum}<b/>`;

  if (!auditLogEnabled) {
    return <AuditLogDisableMode />;
  }

  return (
    <div data-testid="admin-auditlog">
      <button type="button" className="btn btn-outline-secondary mb-4" onClick={() => setIsSettingPage(!isSettingPage)}>
        {
          isSettingPage
            ? <><i className="fa fa-hand-o-left mr-1" />{t('admin:audit_log_management.return')}</>
            : <><i className="fa icon-settings mr-1" />{t('admin:audit_log_management.settings')}</>
        }
      </button>

      <h2 className="admin-setting-header mb-3">
        <span>
          {isSettingPage ? t('AuditLog Settings') : t('AuditLog')}
        </span>
        { !isSettingPage && (
          <button type="button" className="btn btn-sm ml-auto grw-btn-reload" onClick={reloadButtonPushedHandler}>
            <i className="icon icon-reload"></i>
          </button>
        )}
      </h2>

      {isSettingPage ? (
        <AuditLogSettings />
      ) : (
        <>
          <div className="form-inline mb-3">
            <SearchUsernameTypeahead
              ref={typeaheadRef}
              onChange={setUsernamesHandler}
            />

            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={datePickerChangedHandler}
            />

            <SelectActionDropdown
              actionMap={actionMap}
              availableActions={auditLogAvailableActionsData || []}
              onChangeAction={actionCheckboxChangedHandler}
              onChangeMultipleAction={multipleActionCheckboxChangedHandler}
            />

            <button type="button" className="btn btn-link" onClick={clearButtonPushedHandler}>
              {t('admin:audit_log_management.clear')}
            </button>
          </div>

          <p
            className="ml-2"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: activityCounter }}
          />

          { isLoading
            ? (
              <div className="text-muted text-center mb-5">
                <i className="fa fa-2x fa-spinner fa-pulse mr-1" />
              </div>
            )
            : (
              <ActivityTable activityList={activityList} />
            )
          }

          <PaginationWrapper
            activePage={activePage}
            changePage={setActivePageHandler}
            totalItemsCount={totalActivityNum}
            pagingLimit={PAGING_LIMIT}
            align="center"
            size="sm"
          />
        </>
      )}
    </div>
  );
};
