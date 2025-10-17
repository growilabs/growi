import { type JSX, useCallback } from 'react';
import { useRouter } from 'next/router';
import { returnPathForURL } from '@growi/core/dist/utils/path-utils';
import { useTranslation } from 'react-i18next';

import {
  useCurrentPageData,
  useFetchCurrentPage,
  useLatestRevision,
} from '~/states/page';

export const OldRevisionAlert = (): JSX.Element => {
  const router = useRouter();
  const { t } = useTranslation();

  const isOldRevisionPage = useLatestRevision();
  const page = useCurrentPageData();
  const { fetchCurrentPage } = useFetchCurrentPage();

  const onClickShowLatestButton = useCallback(async () => {
    if (page == null) {
      return;
    }

    const url = returnPathForURL(page.path, page._id);
    await router.push(url);
    fetchCurrentPage();
  }, [fetchCurrentPage, page, router]);

  if (page == null || isOldRevisionPage) {
    // biome-ignore lint/complexity/noUselessFragments: ignore
    return <></>;
  }

  return (
    <div className="alert alert-warning">
      <strong>{t('Warning')}: </strong> {t('page_page.notice.version')}
      <button
        type="button"
        className="btn btn-outline-natural-secondary"
        onClick={onClickShowLatestButton}
      >
        <span className="material-symbols-outlined me-1">
          arrow_circle_right
        </span>
        {t('Show latest')}
      </button>
    </div>
  );
};
