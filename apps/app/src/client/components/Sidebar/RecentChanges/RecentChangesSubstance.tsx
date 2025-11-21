import React, {
  memo, useCallback, useEffect, type JSX,
} from 'react';

import {
  isPopulated, type IPageHasId,
} from '@growi/core';
import { DevidedPagePath } from '@growi/core/dist/models';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'react-i18next';

import FormattedDistanceDate from '~/client/components/FormattedDistanceDate';
import InfiniteScroll from '~/client/components/InfiniteScroll';
import { PagePathHierarchicalLink } from '~/components/Common/PagePathHierarchicalLink';
import LinkedPagePath from '~/models/linked-page-path';
import { useSetSearchKeyword } from '~/states/search';
import { useSWRINFxRecentlyUpdated } from '~/stores/page-listing';
import loggerFactory from '~/utils/logger';

import { SidebarHeaderReloadButton } from '../SidebarHeaderReloadButton';

import styles from './RecentChangesSubstance.module.scss';

const formerLinkClass = styles['grw-former-link'];
const pageItemLowerClass = styles['grw-recent-changes-item-lower'];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:History');

type PageItemLowerProps = {
  page: IPageHasId,
}

type PageItemProps = PageItemLowerProps & {
  isSmall: boolean,
  onClickTag?: (tagName: string) => void,
}

const PageItemLower = memo(({ page }: PageItemLowerProps): JSX.Element => {
  return (
    <div className={`${pageItemLowerClass} d-flex justify-content-between grw-recent-changes-item-lower`}>
      <div className="d-flex align-items-center">
        <div className="">
          <span className="material-symbols-outlined p-0">footprint</span>
          <span className="grw-list-counts ms-1">{page.seenUsers.length}</span>
        </div>
        <div className="ms-2">
          <span className="material-symbols-outlined p-0">chat</span>
          <span className="grw-list-counts ms-1">{page.commentCount}</span>
        </div>
      </div>
      <div className="grw-formatted-distance-date mt-auto" data-vrt-blackout-datetime>
        <FormattedDistanceDate id={page._id} date={page.updatedAt} />
      </div>
    </div>
  );
});
PageItemLower.displayName = 'PageItemLower';

type PageTagsProps = PageItemProps;
const PageTags = memo((props: PageTagsProps): JSX.Element => {
  const { page, isSmall, onClickTag } = props;

  if (isSmall || (page.tags.length === 0)) {
    return <></>;
  }

  return (
    <>
      { page.tags.map((tag) => {
        if (!isPopulated(tag)) {
          return <></>;
        }
        return (
          <a
            key={tag.name}
            type="button"
            className="grw-tag badge me-2"
            onClick={() => onClickTag?.(tag.name)}
          >
            {tag.name}
          </a>
        );
      }) }
    </>
  );
});
PageTags.displayName = 'PageTags';

const PageItem = memo(({ page, isSmall, onClickTag }: PageItemProps): JSX.Element => {
  const dPagePath = new DevidedPagePath(page.path, false, true);
  const linkedPagePathFormer = new LinkedPagePath(dPagePath.former);
  const linkedPagePathLatter = new LinkedPagePath(dPagePath.latter);
  const FormerLink = () => (
    <div className={`${formerLinkClass} ${isSmall ? 'text-truncate small' : ''}`}>
      <PagePathHierarchicalLink linkedPagePath={linkedPagePathFormer} />
    </div>
  );

  let locked;
  if (page.grant !== 1) {
    locked = <span className="material-symbols-outlined ms-2 fs-6">lock</span>;
  }

  const isTagElementsRendered = !(isSmall || (page.tags.length === 0));

  return (
    <li className={`list-group-item ${styles['list-group-item']} py-2 px-0`}>
      <div className="d-flex w-100">

        <div>
          <UserPicture user={page.lastUpdateUser} size="md" className="d-inline-block" />
        </div>

        <div className="flex-grow-1 ms-2">
          <div className={`row ${isSmall ? 'gy-0' : 'gy-1'}`}>

            <div className="col-12">
              { !dPagePath.isRoot && <FormerLink /> }
            </div>

            <h6 className={`col-12 d-flex align-items-center ${isSmall ? 'mb-0 text-truncate' : 'mb-0'}`}>
              <PagePathHierarchicalLink linkedPagePath={linkedPagePathLatter} basePath={dPagePath.isRoot ? undefined : dPagePath.former} />
              { page.wip && (
                <span className="wip-page-badge badge rounded-pill text-bg-secondary ms-2">WIP</span>
              ) }
              {locked}
            </h6>

            { isTagElementsRendered && (
              <div className="col-12">
                <PageTags isSmall={isSmall} page={page} onClickTag={onClickTag} />
              </div>
            ) }

            <div className="col-12">
              <PageItemLower page={page} />
            </div>

          </div>
        </div>
      </div>
    </li>
  );
});
PageItem.displayName = 'PageItem';


type HeaderProps = {
  isSmall: boolean,
  onSizeChange: (isSmall: boolean) => void,
  isWipPageShown: boolean,
  onWipPageShownChange: () => void,
}

export const RecentChangesHeader = ({
  isSmall, onSizeChange, isWipPageShown, onWipPageShownChange,
}: HeaderProps): JSX.Element => {
  const { t } = useTranslation();

  const { mutate } = useSWRINFxRecentlyUpdated(isWipPageShown, { suspense: true });

  const retrieveSizePreferenceFromLocalStorage = useCallback(() => {
    if (window.localStorage.isRecentChangesSidebarSmall === 'true') {
      onSizeChange(true);
    }
  }, [onSizeChange]);

  const changeSizeHandler = useCallback(() => {
    onSizeChange(!isSmall);
    window.localStorage.setItem('isRecentChangesSidebarSmall', String(isSmall));
  }, [isSmall, onSizeChange]);

  // componentDidMount
  useEffect(() => {
    retrieveSizePreferenceFromLocalStorage();
  }, [retrieveSizePreferenceFromLocalStorage]);

  return (
    <>
      <SidebarHeaderReloadButton onClick={() => mutate()} />

      <div className="me-1">
        <button
          color="transparent"
          className="btn p-0 border-0"
          type="button"
          data-bs-toggle="dropdown"
          data-bs-auto-close="outside"
          aria-expanded="false"
        >
          <span className="material-symbols-outlined">more_horiz</span>
        </button>

        <ul className="dropdown-menu">
          <li className="dropdown-item" onClick={changeSizeHandler}>
            <div className={`${styles['grw-recent-changes-resize-button']} form-check form-switch mb-0`}>
              <input
                id="recentChangesResize"
                className="form-check-input pe-none"
                type="checkbox"
                checked={isSmall}
                onChange={() => {}}
              />
              <label className="form-check-label pe-none" aria-disabled="true">
                {t('sidebar_header.compact_view')}
              </label>
            </div>
          </li>

          <li className="dropdown-item" onClick={onWipPageShownChange}>
            <div className="form-check form-switch mb-0">
              <input
                id="wipPageVisibility"
                className="form-check-input"
                type="checkbox"
                checked={isWipPageShown}
              />
              <label className="form-check-label pe-none">
                {t('sidebar_header.show_wip_page')}
              </label>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
};

type ContentProps = {
  isSmall: boolean,
  isWipPageShown: boolean,
}

export const RecentChangesContent = ({ isSmall, isWipPageShown }: ContentProps): JSX.Element => {
  const swrInifinitexRecentlyUpdated = useSWRINFxRecentlyUpdated(isWipPageShown, { suspense: true });
  const { data } = swrInifinitexRecentlyUpdated;

  const setSearchKeyword = useSetSearchKeyword();
  const isEmpty = data?.[0]?.pages.length === 0;
  const lastPageIndex = data?.length ? data.length - 1 : 0;
  const isReachingEnd = isEmpty || (data != null && lastPageIndex > 0 && data[lastPageIndex]?.pages.length < data[lastPageIndex - 1]?.pages.length);
  return (
    <div className="grw-recent-changes">
      <ul className="list-group list-group-flush">
        <InfiniteScroll
          swrInifiniteResponse={swrInifinitexRecentlyUpdated}
          isReachingEnd={isReachingEnd}
        >
          { data != null && data.map(apiResult => apiResult.pages).flat()
            .map(page => (
              <PageItem key={page._id} page={page} isSmall={isSmall} onClickTag={tagName => setSearchKeyword(`tag:${tagName}`)} />
            ))
          }
        </InfiniteScroll>
      </ul>
    </div>
  );
};
