import type { JSX } from 'react';
import { isIPageInfoForEntity } from '@growi/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { useCurrentPageData } from '~/states/page';
import { isEnabledStaleNotificationAtom } from '~/states/server-configurations';
import { useSWRxPageInfo } from '~/stores/page';

export const PageStaleAlert = (): JSX.Element => {
  const { t } = useTranslation();
  const isEnabledStaleNotification = useAtomValue(
    isEnabledStaleNotificationAtom,
  );

  // Todo: determine if it should fetch or not like useSWRxPageInfo below after https://redmine.weseek.co.jp/issues/96788
  const pageData = useCurrentPageData();
  const { data: pageInfo } = useSWRxPageInfo(
    isEnabledStaleNotification ? pageData?._id : null,
  );

  const contentAge = isIPageInfoForEntity(pageInfo)
    ? pageInfo.contentAge
    : null;

  if (!isEnabledStaleNotification) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  if (pageInfo == null || contentAge == null || contentAge === 0) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  let alertClass: string;
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
