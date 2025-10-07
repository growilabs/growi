import React, { type JSX } from 'react';

import type { IPageHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';

import { useCurrentPagePath } from '~/states/page';
import { useSWRINFxPageTimeline } from '~/stores/page-timeline';
import { useTimelineOptions } from '~/stores/renderer';

import InfiniteScroll from './InfiniteScroll';
import { RevisionLoader } from './Page/RevisionLoader';

import styles from './PageTimeline.module.scss';


type TimelineCardProps = {
  page: IPageHasId,
}

const TimelineCard = ({ page }: TimelineCardProps): JSX.Element => {

  const { data: rendererOptions } = useTimelineOptions(page.path);

  return (
    <div className={`card card-timeline ${styles['card-timeline']}`}>
      <div className="card-header h4 p-3">
        <Link href={page.path} prefetch={false}>
          {page.path}
        </Link>
      </div>
      <div className="card-body">
        { rendererOptions != null && page.revision != null && (
          <RevisionLoader
            rendererOptions={rendererOptions}
            pageId={page._id}
            revisionId={page.revision}
          />
        ) }
      </div>
    </div>
  );
};

export const PageTimeline = (): JSX.Element => {

  const PER_PAGE = 3;
  const { t } = useTranslation();
  const currentPagePath = useCurrentPagePath();

  const swrInfinitexPageTimeline = useSWRINFxPageTimeline(currentPagePath ?? undefined, PER_PAGE);
  const { data } = swrInfinitexPageTimeline;

  const isEmpty = data?.[0]?.pages.length === 0;
  const isReachingEnd = isEmpty || (data != null && data[data.length - 1]?.pages.length < PER_PAGE);

  if (data == null || isEmpty) {
    return (
      <div className="mt-2">
        <p>{t('custom_navigation.no_pages_under_this_page')}</p>
      </div>
    );
  }

  return (
    <div>
      <InfiniteScroll
        swrInifiniteResponse={swrInfinitexPageTimeline}
        isReachingEnd={isReachingEnd}
      >
        { data != null && data.flatMap(apiResult => apiResult.pages)
          .map(page => (
            <TimelineCard key={page._id} page={page} />
          ))
        }
      </InfiniteScroll>
    </div>
  );
};
