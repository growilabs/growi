import type { FC } from 'react';
import React, { useState, useCallback } from 'react';

import { isPopulated } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { UserPicture } from '@growi/ui/dist/components';
import { format } from 'date-fns/format';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'reactstrap';

import type { IActivityHasId } from '~/interfaces/activity';

 type Props = {
   activityList: IActivityHasId[]
 }

const formatDate = (date: Date): string => {
  return format(new Date(date), 'yyyy/MM/dd HH:mm:ss');
};

export const ActivityTable : FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const [activeTooltipId, setActiveTooltipId] = useState<string | null>(null);


  const showToolTip = useCallback((id: string) => {
    setActiveTooltipId(id);
    setTimeout(() => {
      setActiveTooltipId(null);
    }, 1000);
  }, []);

  return (
    <div className="table-responsive admin-audit-log">
      <table className="table table-default table-bordered table-user-list">
        <thead>
          <tr>
            <th scope="col">{t('admin:audit_log_management.user')}</th>
            <th scope="col">{t('admin:audit_log_management.date')}</th>
            <th scope="col">{t('admin:audit_log_management.action')}</th>
            <th scope="col">{t('admin:audit_log_management.ip')}</th>
            <th scope="col">{t('admin:audit_log_management.url')}</th>
          </tr>
        </thead>
        <tbody>
          {props.activityList.map((activity) => {
            return (
              <tr data-testid="activity-table" key={activity._id}>
                <td>
                  { activity.user != null && (
                    <>
                      <UserPicture user={activity.user} />
                      <a
                        className="ms-2"
                        href={isPopulated(activity.user) ? pagePathUtils.userHomepagePath(activity.user) : undefined}
                      >
                        {activity.snapshot?.username}
                      </a>
                    </>
                  )}
                </td>
                <td>{formatDate(activity.createdAt)}</td>
                <td>{t(`admin:audit_log_action.${activity.action}`)}</td>
                <td>{activity.ip}</td>
                <td className="audit-log-url-cell">
                  <div className="d-flex align-items-center">
                    <span className="flex-grow-1 text-truncate">
                      {activity.endpoint}
                    </span>
                    <CopyToClipboard text={activity.endpoint} onCopy={() => showToolTip(activity._id)}>
                      <button type="button" className="btn btn-outline-secondary border-0 ms-2" id={`tooltipTarget-${activity._id}`}>
                        <span className="material-symbols-outlined" aria-hidden="true">content_paste</span>
                      </button>
                    </CopyToClipboard>
                    <Tooltip placement="top" isOpen={activeTooltipId === activity._id} fade={false} target={`tooltipTarget-${activity._id}`}>
                      copied!
                    </Tooltip>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
