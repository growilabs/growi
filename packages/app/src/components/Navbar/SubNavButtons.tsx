import React, { useCallback } from 'react';

import { IPageInfoAll, isIPageInfoForEntity, isIPageInfoForOperation } from '~/interfaces/page';

import { useSWRxPageInfo } from '../../stores/page';
import { useSWRBookmarkInfo } from '../../stores/bookmark';
import { useSWRxUsersList } from '../../stores/user';
import { useIsGuestUser } from '~/stores/context';

import SubscribeButton from '../SubscribeButton';
import LikeButtons from '../LikeButtons';
import BookmarkButtons from '../BookmarkButtons';
import SeenUserInfo from '../User/SeenUserInfo';
import { toggleBookmark, toggleLike, toggleSubscribe } from '~/client/services/page-operation';
import { AdditionalMenuItemsRendererProps, PageItemControl } from '../Common/Dropdown/PageItemControl';


type CommonProps = {
  isCompactMode?: boolean,
  disableSeenUserInfoPopover?: boolean,
  showPageControlDropdown?: boolean,
  additionalMenuItemRenderer?: React.FunctionComponent<AdditionalMenuItemsRendererProps>,
}

type SubNavButtonsSubstanceProps= CommonProps & {
  pageId: string,
  revisionId: string,
  pageInfo: IPageInfoAll,
}

const SubNavButtonsSubstance = (props: SubNavButtonsSubstanceProps): JSX.Element => {
  const {
    pageInfo, pageId, isCompactMode, disableSeenUserInfoPopover, showPageControlDropdown, additionalMenuItemRenderer,
  } = props;

  const { data: isGuestUser } = useIsGuestUser();

  const { mutate: mutatePageInfo } = useSWRxPageInfo(pageId);

  const { data: bookmarkInfo, mutate: mutateBookmarkInfo } = useSWRBookmarkInfo(pageId);

  const likerIds = isIPageInfoForEntity(pageInfo) ? (pageInfo.likerIds ?? []).slice(0, 15) : [];
  const seenUserIds = isIPageInfoForEntity(pageInfo) ? (pageInfo.seenUserIds ?? []).slice(0, 15) : [];

  // Put in a mixture of seenUserIds and likerIds data to make the cache work
  const { data: usersList } = useSWRxUsersList([...likerIds, ...seenUserIds]);
  const likers = usersList != null ? usersList.filter(({ _id }) => likerIds.includes(_id)).slice(0, 15) : [];
  const seenUsers = usersList != null ? usersList.filter(({ _id }) => seenUserIds.includes(_id)).slice(0, 15) : [];

  const subscribeClickhandler = useCallback(async() => {
    if (isGuestUser == null || isGuestUser) {
      return;
    }
    if (!isIPageInfoForOperation(pageInfo)) {
      return;
    }

    await toggleSubscribe(pageId, pageInfo.subscriptionStatus);
    mutatePageInfo();
  }, [isGuestUser, mutatePageInfo, pageId, pageInfo]);

  const likeClickhandler = useCallback(async() => {
    if (isGuestUser == null || isGuestUser) {
      return;
    }
    if (!isIPageInfoForOperation(pageInfo)) {
      return;
    }

    await toggleLike(pageId, pageInfo.isLiked);
    mutatePageInfo();
  }, [isGuestUser, mutatePageInfo, pageId, pageInfo]);

  const bookmarkClickHandler = useCallback(async() => {
    if (isGuestUser == null || isGuestUser) {
      return;
    }
    if (!isIPageInfoForOperation(pageInfo)) {
      return;
    }

    await toggleBookmark(pageId, pageInfo.isBookmarked);
    mutatePageInfo();
    mutateBookmarkInfo();
  }, [isGuestUser, mutateBookmarkInfo, mutatePageInfo, pageId, pageInfo]);

  if (!isIPageInfoForOperation(pageInfo)) {
    return <></>;
  }

  const {
    sumOfLikers, isLiked, bookmarkCount, isBookmarked,
  } = pageInfo;

  return (
    <div className="d-flex" style={{ gap: '2px' }}>
      <span>
        <SubscribeButton
          status={pageInfo.subscriptionStatus}
          onClick={subscribeClickhandler}
        />
      </span>
      <LikeButtons
        hideTotalNumber={isCompactMode}
        onLikeClicked={likeClickhandler}
        sumOfLikers={sumOfLikers}
        isLiked={isLiked}
        likers={likers}
      />
      <BookmarkButtons
        hideTotalNumber={isCompactMode}
        bookmarkCount={bookmarkCount}
        isBookmarked={isBookmarked}
        bookmarkedUsers={bookmarkInfo?.bookmarkedUsers}
        onBookMarkClicked={bookmarkClickHandler}
      />
      <SeenUserInfo seenUsers={seenUsers} disabled={disableSeenUserInfoPopover} />
      { showPageControlDropdown && (
        <PageItemControl
          pageId={pageId}
          pageInfo={pageInfo}
          isEnableActions={!isGuestUser}
          additionalMenuItemRenderer={additionalMenuItemRenderer}
        />
        // <PageManagement
        //   pageId={pageId}
        //   revisionId={revisionId}
        //   path={path}
        //   isCompactMode={isCompactMode}
        //   isDeletable={isDeletable}
        //   isAbleToDeleteCompletely={isAbleToDeleteCompletely}
        // >
        // </PageManagement>
      )}
    </div>
  );
};

type SubNavButtonsProps= CommonProps & {
  pageId: string,
  revisionId?: string | null,
};

export const SubNavButtons = (props: SubNavButtonsProps): JSX.Element => {
  const { pageId, revisionId } = props;

  const { data: pageInfo, error } = useSWRxPageInfo(pageId ?? null);

  if (revisionId == null || error != null) {
    return <></>;
  }

  if (!isIPageInfoForOperation(pageInfo)) {
    return <></>;
  }

  return <SubNavButtonsSubstance {...props} pageInfo={pageInfo} pageId={pageId} revisionId={revisionId} />;
};
