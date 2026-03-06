import type { FC } from 'react';
import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import type { IDataTagCount } from '~/interfaces/tag';
import { useSWRxTagsList } from '~/stores/tag';

import TagCloudBox from '../TagCloudBox';
import TagList from '../TagList';
import { SidebarHeaderReloadButton } from './SidebarHeaderReloadButton';
import { TagListSkeleton } from './Skeleton/TagContentSkeleton';

const PAGING_LIMIT = 10;
const TAG_CLOUD_LIMIT = 20;

const Tag: FC = () => {
  const [activePage, setActivePage] = useState<number>(1);
  const [offset, setOffset] = useState<number>(0);

  const {
    data: tagDataList,
    mutate: mutateTagDataList,
    error,
  } = useSWRxTagsList(PAGING_LIMIT, offset);
  const tagData: IDataTagCount[] = tagDataList?.data || [];
  const totalCount: number = tagDataList?.totalCount || 0;
  const isLoading = tagDataList === undefined && error == null;

  const { data: tagDataCloud } = useSWRxTagsList(TAG_CLOUD_LIMIT, 0);
  const tagCloudData: IDataTagCount[] = tagDataCloud?.data || [];

  const { t } = useTranslation('');

  const setOffsetByPageNumber = useCallback((selectedPageNumber: number) => {
    setActivePage(selectedPageNumber);
    setOffset((selectedPageNumber - 1) * PAGING_LIMIT);
  }, []);

  const onReload = useCallback(() => {
    mutateTagDataList();
  }, [mutateTagDataList]);

  // todo: adjust design by XD
  return (
    <div
      className="container-lg px-3 mb-5 pb-5"
      data-testid="grw-sidebar-content-tags"
    >
      <div className="grw-sidebar-content-header pt-4 pb-3 d-flex">
        <h3 className="fs-6 fw-bold mb-0">{t('Tags')}</h3>
        <SidebarHeaderReloadButton onClick={() => onReload()} />
      </div>

      <h6 className="my-3 pb-1 border-bottom">{t('tag_list')}</h6>

      {isLoading ? (
        <TagListSkeleton />
      ) : (
        <div data-testid="grw-tags-list">
          <TagList
            tagData={tagData}
            totalTags={totalCount}
            activePage={activePage}
            onChangePage={setOffsetByPageNumber}
            pagingLimit={PAGING_LIMIT}
          />
        </div>
      )}

      <div
        className="d-flex justify-content-center my-5"
        data-testid="check-all-tags-button"
      >
        <Link
          href="/tags"
          className="btn btn-primary rounded px-4"
          role="button"
          prefetch={false}
        >
          {t('Check All tags')}
        </Link>
      </div>

      <h6 className="my-3 pb-1 border-bottom">{t('popular_tags')}</h6>

      <TagCloudBox tags={tagCloudData} />
    </div>
  );
};

export default Tag;
