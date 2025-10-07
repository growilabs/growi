import { isIPageInfoForEntity } from '@growi/core';
import { useTranslation } from 'next-i18next';
import type { JSX } from 'react';
import { useSWRxCurrentPage, useSWRxPageInfo } from '~/stores/page';
import { useIsEnabledStaleNotification } from '~/stores-universal/context';

export const PageStaleAlert = (): JSX.Element => {
  const { t } = useTranslation();
  const { data: isEnabledStaleNotification } = useIsEnabledStaleNotification();

  // Todo: determine if it should fetch or not like useSWRxPageInfo below after https://redmine.weseek.co.jp/issues/96788
  const { data: pageData } = useSWRxCurrentPage();
  const { data: pageInfo } = useSWRxPageInfo(
    isEnabledStaleNotification ? pageData?._id : null,
  );

  const contentAge = isIPageInfoForEntity(pageInfo)
    ? pageInfo.contentAge
    : null;

  if (!isEnabledStaleNotification) {
    return <></>;
  }

  if (pageInfo == null || contentAge == null || contentAge === 0) {
    return <></>;
  }

  let alertClass;
  switch (contentAge) {
    case 1:
      alertClass = 'alert-info';
      break;
    case 2:
      alertClass = 'alert-warning';
      break;
    default:
      alertClass = 'alert-danger';
  }

  return (
    <div className={`alert ${alertClass}`}>
      <span className="material-symbols-outlined me-1">hourglass</span>
      <strong>{t('page_page.notice.stale', { count: contentAge })}</strong>
    </div>
  );
};
