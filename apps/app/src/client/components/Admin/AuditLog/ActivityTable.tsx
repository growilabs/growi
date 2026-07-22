import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import type { IActivityHasId } from '~/interfaces/activity';

import { ActivityTableRow } from './ActivityTableRow';

type Props = {
  activityList: IActivityHasId[];
};

export const ActivityTable: FC<Props> = (props: Props) => {
  const { t } = useTranslation();

  return (
    <div className="table-responsive admin-audit-log">
      <table className="table table-default table-bordered table-user-list">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">{t('admin:audit_log_management.user')}</th>
            <th scope="col">{t('admin:audit_log_management.date')}</th>
            <th scope="col">{t('admin:audit_log_management.action')}</th>
            <th scope="col">{t('admin:audit_log_management.ip')}</th>
            <th scope="col">{t('admin:audit_log_management.url')}</th>
          </tr>
        </thead>
        <tbody>
          {props.activityList.map((activity) => (
            <ActivityTableRow key={activity._id} activity={activity} />
          ))}
        </tbody>
      </table>
    </div>
  );
};
