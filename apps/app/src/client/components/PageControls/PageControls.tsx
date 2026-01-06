import React, {
  memo, useCallback, useEffect, useMemo, useRef, type JSX,
} from 'react';

import type {
  IPageInfo, IPageToDeleteWithMeta, IPageToRenameWithMeta,
} from '@growi/core';
import {
  isIPageInfoForEmpty,

  isIPageInfoForEntity, isIPageInfoForOperation,
} from '@growi/core';
import { useRect } from '@growi/ui/dist/utils';
import { useTranslation } from 'next-i18next';
import { DropdownItem } from 'reactstrap';

import {
  toggleLike, toggleSubscribe,
} from '~/client/services/page-operation';
import { toastError } from '~/client/util/toastr';
import OpenDefaultAiAssistantButton from '~/features/openai/client/components/AiAssistant/OpenDefaultAiAssistantButton';
import { useIsGuestUser, useIsReadOnlyUser, useIsSearchPage } from '~/states/context';
import { useCurrentPagePath } from '~/states/page';
import { useDeviceLargerThanMd } from '~/states/ui/device';
import {
  EditorMode, useEditorMode,
} from '~/states/ui/editor';
import { type IPageForPageDuplicateModal } from '~/states/ui/modal/page-duplicate';
import { useTagEditModalActions } from '~/states/ui/modal/tag-edit';
import { useSetPageControlsX } from '~/states/ui/page';
import loggerFactory from '~/utils/logger';

import { useSWRxPageInfo, useSWRxTagsInfo } from '../../../stores/page';
import { useSWRxUsersList } from '../../../stores/user';
import type { AdditionalMenuItemsRendererProps, ForceHideMenuItems } from '../Common/Dropdown/PageItemControl';
import {
  MenuItemType,
  PageItemControl,
} from '../Common/Dropdown/PageItemControl';

import { BookmarkButtons } from './BookmarkButtons';
import LikeButtons from './LikeButtons';
import SearchButton from './SearchButton';
import SeenUserInfo from './SeenUserInfo';
import SubscribeButton from './SubscribeButton';


import styles from './PageControls.module.scss';

const logger = loggerFactory('growi:components/PageControls');


type TagsProps = {
  onClickEditTagsButton: () => void,
}

const Tags = (props: TagsProps): JSX.Element => {
  const { onClickEditTagsButton } = props;
  const { t } = useTranslation();

  return (
    <div className="grw-tag-labels-container d-flex align-items-center">
      <button
        type="button"
        className="btn btn-sm btn-outline-neutral-secondary"
        onClick={onClickEditTagsButton}
      >
        <span className="material-symbols-outlined">local_offer</span>
        <span className="d-none d-sm-inline ms-1">{t('Tags')}</span>
      </button>
    </div>
  );
};

type WideViewMenuItemProps = AdditionalMenuItemsRendererProps & {
  onClick: () => void,
  expandContentWidth?: boolean,
}

const WideViewMenuItem = (props: WideViewMenuItemProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    onClick, expandContentWidth,
  } = props;

  return (
    <DropdownItem className="grw-page-control-dropdown-item dropdown-item" onClick={onClick} toggle={false}>
      <div className="form-check form-switch ms-1">
        <input
          className="form-check-input pe-none"
          type="checkbox"
          checked={expandContentWidth}
          onChange={() => { }}
        />
        <label className="form-check-label pe-none">
          {t('wide_view')}
        </label>
      </div>
    </DropdownItem>
  );
};


type CommonProps = {
  pageId?: string,
  shareLinkId?: string | null,
  revisionId?: string | null,
  path?: string | null,
  expandContentWidth?: boolean,
  disableSeenUserInfoPopover?: boolean,
  hideSubControls?: boolean,
  showPageControlDropdown?: boolean,
  forceHideMenuItems?: ForceHideMenuItems,
  additionalMenuItemRenderer?: React.FunctionComponent<AdditionalMenuItemsRendererProps>,
  onClickDuplicateMenuItem?: (pageToDuplicate: IPageForPageDuplicateModal) => void,
  onClickRenameMenuItem?: (pageToRename: IPageToRenameWithMeta) => void,
  onClickDeleteMenuItem?: (pageToDelete: IPageToDeleteWithMeta) => void,
  onClickSwitchContentWidth?: (pageId: string, value: boolean) => void,
}

type PageControlsSubstanceProps = CommonProps & {
  pageInfo: IPageInfo | undefined,
  onClickEditTagsButton: () => void,
}

const PageControlsSubstance = (props: PageControlsSubstanceProps): JSX.Element => {
  const {
    pageInfo,
    pageId, revisionId, path, shareLinkId, expandContentWidth,
    disableSeenUserInfoPopover, hideSubControls, showPageControlDropdown, forceHideMenuItems, additionalMenuItemRenderer,
    onClickEditTagsButton, onClickDuplicateMenuItem, onClickRenameMenuItem, onClickDeleteMenuItem, onClickSwitchContentWidth,
  } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const { editorMode } = useEditorMode();
  const [isDeviceLargerThanMd] = useDeviceLargerThanMd();
  const isSearchPage = useIsSearchPage();
  const currentPagePath = useCurrentPagePath();

  const { mutate: mutatePageInfo } = useSWRxPageInfo(pageId, shareLinkId);

  const likerIds = isIPageInfoForEntity(pageInfo) ? (pageInfo.likerIds ?? []).slice(0, 15) : [];
  const seenUserIds = isIPageInfoForEntity(pageInfo) ? (pageInfo.seenUserIds ?? []).slice(0, 15) : [];

  const setPageControlsX = useSetPageControlsX();

  const pageControlsRef = useRef<HTMLDivElement>(null);
  const [pageControlsRect] = useRect(pageControlsRef);

  useEffect(() => {
    if (pageControlsRect?.x == null) {
      return;
    }
    setPageControlsX(pageControlsRect.x);
  }, [pageControlsRect?.x, setPageControlsX]);


  // Put in a mixture of seenUserIds and likerIds data to make the cache work
  const { data: usersList } = useSWRxUsersList([...likerIds, ...seenUserIds]);
  const likers = usersList != null ? usersList.filter(({ _id }) => likerIds.includes(_id)).slice(0, 15) : [];
  const seenUsers = usersList != null ? usersList.filter(({ _id }) => seenUserIds.includes(_id)).slice(0, 15) : [];

  const subscribeClickhandler = useCallback(async () => {
    if (isGuestUser) {
      logger.warn('Guest users cannot subscribe to pages');
      return;
    }
    if (!isIPageInfoForOperation(pageInfo) || pageId == null) {
      logger.warn('PageInfo is not for operation or pageId is null');
      return;
    }

    await toggleSubscribe(pageId, pageInfo.subscriptionStatus);
    mutatePageInfo();
  }, [isGuestUser, mutatePageInfo, pageId, pageInfo]);

  const likeClickhandler = useCallback(async () => {
    if (isGuestUser) {
      logger.warn('Guest users cannot like pages');
      return;
    }
    if (!isIPageInfoForOperation(pageInfo) || pageId == null) {
      logger.warn('PageInfo is not for operation or pageId is null');
      return;
    }

    await toggleLike(pageId, pageInfo.isLiked);
    mutatePageInfo();
  }, [isGuestUser, mutatePageInfo, pageId, pageInfo]);

  const duplicateMenuItemClickHandler = useCallback(async (): Promise<void> => {
    if (onClickDuplicateMenuItem == null || pageId == null || path == null) {
      logger.warn('Cannot duplicate the page because onClickDuplicateMenuItem, pageId or path is null');
      return;
    }
    const page: IPageForPageDuplicateModal = { pageId, path };

    onClickDuplicateMenuItem(page);
  }, [onClickDuplicateMenuItem, pageId, path]);

  const renameMenuItemClickHandler = useCallback(async (): Promise<void> => {
    if (onClickRenameMenuItem == null || pageId == null || path == null) {
      logger.warn('Cannot rename the page because onClickRenameMenuItem, pageId or path is null');
      return;
    }

    const page: IPageToRenameWithMeta = {
      data: {
        _id: pageId,
        revision: revisionId ?? null,
        path,
      },
      meta: pageInfo,
    };

    onClickRenameMenuItem(page);
  }, [onClickRenameMenuItem, pageId, pageInfo, path, revisionId]);

  const deleteMenuItemClickHandler = useCallback(async (): Promise<void> => {
    if (onClickDeleteMenuItem == null || pageId == null || path == null) {
      logger.warn('Cannot delete the page because onClickDeleteMenuItem, pageId or path is null');
      return;
    }

    const pageToDelete: IPageToDeleteWithMeta = {
      data: {
        _id: pageId,
        revision: revisionId ?? null,
        path,
      },
      meta: pageInfo,
    };

    onClickDeleteMenuItem(pageToDelete);
  }, [onClickDeleteMenuItem, pageId, pageInfo, path, revisionId]);

  const switchContentWidthClickHandler = useCallback(() => {
    if (isGuestUser || isReadOnlyUser) {
      logger.warn('Guest or read-only users cannot switch content width');
      return;
    }

    if (onClickSwitchContentWidth == null || pageId == null) {
      logger.warn('Cannot switch content width because onClickSwitchContentWidth or pageId is null');
      return;
    }
    if (!isIPageInfoForEntity(pageInfo)) {
      logger.warn('PageInfo is not for entity');
      return;
    }

    try {
      const newValue = !expandContentWidth;
      onClickSwitchContentWidth(pageId, newValue);
    }
    catch (err) {
      toastError(err);
    }
  }, [expandContentWidth, isGuestUser, isReadOnlyUser, onClickSwitchContentWidth, pageId, pageInfo]);

  const isEnableActions = useMemo(() => {
    if (isGuestUser) {
      return false;
    }

    if (currentPagePath == null) {
      return false;
    }

    return true;
  }, [currentPagePath, isGuestUser]);

  const additionalMenuItemOnTopRenderer = useMemo(() => {
    if (!isIPageInfoForEntity(pageInfo)) {
      return undefined;
    }
    if (onClickSwitchContentWidth == null) {
      return undefined;
    }

    const wideviewMenuItemRenderer = (props: WideViewMenuItemProps) => {
      return <WideViewMenuItem {...props} onClick={switchContentWidthClickHandler} expandContentWidth={expandContentWidth} />;
    };
    return wideviewMenuItemRenderer;
  }, [pageInfo, expandContentWidth, onClickSwitchContentWidth, switchContentWidthClickHandler]);

  const forceHideMenuItemsWithAdditions = [
    ...(forceHideMenuItems ?? []),
    MenuItemType.BOOKMARK,
    MenuItemType.REVERT,
  ];

  const isViewMode = editorMode === EditorMode.View;

  return (
    <div className={`${styles['grw-page-controls']} hstack gap-2`} ref={pageControlsRef}>
      {isViewMode && isDeviceLargerThanMd && !isSearchPage && !isSearchPage && (
        <>
          <SearchButton />
          <OpenDefaultAiAssistantButton />
        </>
      )}

      {revisionId != null && !isViewMode && (
        <Tags
          onClickEditTagsButton={onClickEditTagsButton}
        />
      )}

      {!hideSubControls && (
        <div className={`hstack gap-1 ${!isViewMode && 'd-none d-lg-flex'}`}>
          {isIPageInfoForOperation(pageInfo) && (
            <SubscribeButton
              status={pageInfo.subscriptionStatus}
              onClick={subscribeClickhandler}
            />
          )}
          {isIPageInfoForOperation(pageInfo) && (
            <LikeButtons
              onLikeClicked={likeClickhandler}
              sumOfLikers={pageInfo.sumOfLikers}
              isLiked={pageInfo.isLiked}
              likers={likers}
            />
          )}
          {(isIPageInfoForOperation(pageInfo) || isIPageInfoForEmpty(pageInfo)) && pageId != null && (
            <BookmarkButtons
              pageId={pageId}
              isBookmarked={pageInfo.isBookmarked}
              bookmarkCount={pageInfo.bookmarkCount}
            />
          )}
          {isIPageInfoForEntity(pageInfo) && !isSearchPage && (
            <SeenUserInfo
              seenUsers={seenUsers}
              sumOfSeenUsers={pageInfo.sumOfSeenUsers}
              disabled={disableSeenUserInfoPopover}
            />
          )}
        </div>
      )}

      {showPageControlDropdown && (
        <PageItemControl
          pageId={pageId}
          pageInfo={pageInfo}
          isEnableActions={isEnableActions}
          isReadOnlyUser={!!isReadOnlyUser}
          forceHideMenuItems={forceHideMenuItemsWithAdditions}
          additionalMenuItemOnTopRenderer={!isReadOnlyUser ? additionalMenuItemOnTopRenderer : undefined}
          additionalMenuItemRenderer={additionalMenuItemRenderer}
          onClickRenameMenuItem={renameMenuItemClickHandler}
          onClickDuplicateMenuItem={duplicateMenuItemClickHandler}
          onClickDeleteMenuItem={deleteMenuItemClickHandler}
        />
      )}
    </div>
  );
};

type PageControlsProps = CommonProps;

export const PageControls = memo((props: PageControlsProps): JSX.Element => {
  const {
    pageId, revisionId, shareLinkId,
    ...rest
  } = props;

  const { data: pageInfo, error } = useSWRxPageInfo(pageId ?? null, shareLinkId);
  const { data: tagsInfoData } = useSWRxTagsInfo(pageId);
  const { open: openTagEditModal } = useTagEditModalActions();

  const onClickEditTagsButton = useCallback(() => {
    if (tagsInfoData == null || pageId == null || revisionId == null) {
      return;
    }
    openTagEditModal(tagsInfoData.tags, pageId, revisionId);
  }, [pageId, revisionId, tagsInfoData, openTagEditModal]);

  if (error != null) {
    return <></>;
  }

  return (
    <PageControlsSubstance
      pageInfo={pageInfo}
      pageId={pageId}
      revisionId={revisionId}
      onClickEditTagsButton={onClickEditTagsButton}
      {...rest}
    />
  );
});
