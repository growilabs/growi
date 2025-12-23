import React from 'react';

import { useTranslation } from 'next-i18next';

type UserStatistics = {
  total: number;
  active: { total: number };
  inactive: { total: number };
};

type Props = {
  userStatistics?: UserStatistics | null;
};

const UserStatisticsTable: React.FC<Props> = ({ userStatistics }) => {
  const { t } = useTranslation('admin');
  if (userStatistics == null) return null;

  return (
    <table className="table table-bordered w-100">
      <tbody>
        <tr>
          <th className="col-sm-4 align-top">{t('user_management.user_statistics.total')}</th>
          <td className="align-top">{ userStatistics.total }</td>
        </tr>
        <tr>
          <th className="col-sm-4 align-top">{t('user_management.user_statistics.active')}</th>
          <td className="align-top">{ userStatistics.active.total }</td>
        </tr>
        <tr>
          <th className="col-sm-4 align-top">{t('user_management.user_statistics.inactive')}</th>
          <td className="align-top">{ userStatistics.inactive.total }</td>
        </tr>
      </tbody>
    </table>
  );
};

export default UserStatisticsTable;
