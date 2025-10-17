import { type RefObject, useCallback, useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/router';
import { type Nullable, PageGrant } from '@growi/core';
import {
  type SWRResponseWithUtils,
  useSWRStatic,
  withUtils,
} from '@growi/core/dist/swr';
import { isClient, pagePathUtils } from '@growi/core/dist/utils';
import { Breakpoint } from '@growi/ui/dist/interfaces';
import {
  addBreakpointListener,
  cleanupBreakpointListener,
} from '@growi/ui/dist/utils';
import type { HtmlElementNode } from 'rehype-toc';
import type { MutatorOptions } from 'swr';
import { type Key, type SWRResponse, useSWRConfig } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { scheduleToPut } from '~/client/services/user-ui-settings';
import type { IPageSelectedGrant } from '~/interfaces/page';
import { SidebarContentsType, SidebarMode } from '~/interfaces/ui';
import type { UpdateDescCountData } from '~/interfaces/websocket';
import {
  useCurrentPageId,
  useCurrentPagePath,
  useIsNotFound,
  useIsTrashPage,
} from '~/stores/page';
import {
  useCurrentUser,
  useIsEditable,
  useIsIdenticalPath,
  useIsReadOnlyUser,
  useIsSharedUser,
  useShareLinkId,
} from '~/stores-universal/context';
import { EditorMode, useEditorMode } from '~/stores-universal/ui';
import loggerFactory from '~/utils/logger';

import { useStaticSWR } from './use-static-swr';

const { isTrashTopPage, isUsersTopPage } = pagePathUtils;

const logger = loggerFactory('growi:stores:ui');

/** **********************************************************
 *                     Storing objects to ref
 *********************************************************** */

export const useCurrentPageTocNode = (): SWRResponse<HtmlElementNode, any> => {
  const { data: currentPagePath } = useCurrentPagePath();

  return useStaticSWR(['currentPageTocNode', currentPagePath]);
};

/** **********************************************************
 *                          SWR Hooks
 *                      for switching UI
 *********************************************************** */

export const useSidebarScrollerRef = (
  initialData?: RefObject<HTMLDivElement | null>,
): SWRResponse<RefObject<HTMLDivElement | null>, Error> => {
  return useSWRStatic<RefObject<HTMLDivElement | null>, Error>(
    'sidebarScrollerRef',
    initialData,
  );
};

//
export const useIsMobile = (): SWRResponse<boolean, Error> => {
  const key = isClient() ? 'isMobile' : null;

  let configuration = {
    fallbackData: false,
  };

  if (isClient()) {
    // Ref: https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent#mobile_device_detection
    let hasTouchScreen = false;
    hasTouchScreen =
      'maxTouchPoints' in navigator ? navigator?.maxTouchPoints > 0 : false;

    if (!hasTouchScreen) {
      const mQ = matchMedia?.('(pointer:coarse)');
      if (mQ?.media === '(pointer:coarse)') {
        hasTouchScreen = !!mQ.matches;
      } else {
        // Only as a last resort, fall back to user agent sniffing
        const UA = navigator.userAgent;
        hasTouchScreen =
          /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(UA) ||
          /\b(Android|Windows Phone|iPad|iPod)\b/i.test(UA);
      }
    }

    configuration = {
      fallbackData: hasTouchScreen,
    };
  }

  return useSWRStatic<boolean, Error>(key, undefined, configuration);
};

export const useIsDeviceLargerThanMd = (): SWRResponse<boolean, Error> => {
  const key: Key = isClient() ? 'isDeviceLargerThanMd' : null;

  const { cache, mutate } = useSWRConfig();

  useEffect(() => {
    if (key != null) {
      const mdOrAvobeHandler = function (this: MediaQueryList): void {
        // sm -> md: matches will be true
        // md -> sm: matches will be false
        mutate(key, this.matches);
      };
      const mql = addBreakpointListener(Breakpoint.MD, mdOrAvobeHandler);

      // initialize
      if (cache.get(key)?.data == null) {
        cache.set(key, { ...cache.get(key), data: mql.matches });
      }

      return () => {
        cleanupBreakpointListener(mql, mdOrAvobeHandler);
      };
    }
  }, [cache, key, mutate]);

  return useSWRStatic(key);
};

export const useIsDeviceLargerThanLg = (): SWRResponse<boolean, Error> => {
  const key: Key = isClient() ? 'isDeviceLargerThanLg' : null;

  const { cache, mutate } = useSWRConfig();

  useEffect(() => {
    if (key != null) {
      const lgOrAvobeHandler = function (this: MediaQueryList): void {
        // md -> lg: matches will be true
        // lg -> md: matches will be false
        mutate(key, this.matches);
      };
      const mql = addBreakpointListener(Breakpoint.LG, lgOrAvobeHandler);

      // initialize
      if (cache.get(key)?.data == null) {
        cache.set(key, { ...cache.get(key), data: mql.matches });
      }

      return () => {
        cleanupBreakpointListener(mql, lgOrAvobeHandler);
      };
    }
  }, [cache, key, mutate]);

  return useSWRStatic(key);
};

export const useIsDeviceLargerThanXl = (): SWRResponse<boolean, Error> => {
  const key: Key = isClient() ? 'isDeviceLargerThanXl' : null;

  const { cache, mutate } = useSWRConfig();

  useEffect(() => {
    if (key != null) {
      const xlOrAvobeHandler = function (this: MediaQueryList): void {
        // lg -> xl: matches will be true
        // xl -> lg: matches will be false
        mutate(key, this.matches);
      };
      const mql = addBreakpointListener(Breakpoint.XL, xlOrAvobeHandler);

      // initialize
      if (cache.get(key)?.data == null) {
        cache.set(key, { ...cache.get(key), data: mql.matches });
      }

      return () => {
        cleanupBreakpointListener(mql, xlOrAvobeHandler);
      };
    }
  }, [cache, key, mutate]);

  return useSWRStatic(key);
};

type MutateAndSaveUserUISettings<Data> = (
  data: Data,
  opts?: boolean | MutatorOptions<Data>,
) => Promise<Data | undefined>;
type MutateAndSaveUserUISettingsUtils<Data> = {
  mutateAndSave: MutateAndSaveUserUISettings<Data>;
};

export const useCurrentSidebarContents = (
  initialData?: SidebarContentsType,
): SWRResponseWithUtils<
  MutateAndSaveUserUISettingsUtils<SidebarContentsType>,
  SidebarContentsType
> => {
  const swrResponse = useSWRStatic('sidebarContents', initialData, {
    fallbackData: SidebarContentsType.TREE,
  });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<SidebarContentsType> =
    useCallback(
      (data, opts?) => {
        scheduleToPut({ currentSidebarContents: data });
        return mutate(data, opts);
      },
      [mutate],
    );

  return withUtils(swrResponse, { mutateAndSave });
};

export const usePageControlsX = (initialData?: number): SWRResponse<number> => {
  return useSWRStatic('pageControlsX', initialData);
};

export const useCurrentProductNavWidth = (
  initialData?: number,
): SWRResponseWithUtils<MutateAndSaveUserUISettingsUtils<number>, number> => {
  const swrResponse = useSWRStatic('productNavWidth', initialData, {
    fallbackData: 320,
  });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<number> = useCallback(
    (data, opts?) => {
      scheduleToPut({ currentProductNavWidth: data });
      return mutate(data, opts);
    },
    [mutate],
  );

  return withUtils(swrResponse, { mutateAndSave });
};

export const usePreferCollapsedMode = (
  initialData?: boolean,
): SWRResponseWithUtils<MutateAndSaveUserUISettingsUtils<boolean>, boolean> => {
  const swrResponse = useSWRStatic('isPreferCollapsedMode', initialData, {
    fallbackData: false,
  });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<boolean> = useCallback(
    (data, opts?) => {
      scheduleToPut({ preferCollapsedModeByUser: data });
      return mutate(data, opts);
    },
    [mutate],
  );

  return withUtils(swrResponse, { mutateAndSave });
};

export const useCollapsedContentsOpened = (
  initialData?: boolean,
): SWRResponse<boolean> => {
  return useSWRStatic('isCollapsedContentsOpened', initialData, {
    fallbackData: false,
  });
};

export const useDrawerOpened = (
  isOpened?: boolean,
): SWRResponse<boolean, Error> => {
  return useSWRStatic('isDrawerOpened', isOpened, { fallbackData: false });
};

type DetectSidebarModeUtils = {
  isDrawerMode(): boolean;
  isCollapsedMode(): boolean;
  isDockMode(): boolean;
};

export const useSidebarMode = (): SWRResponseWithUtils<
  DetectSidebarModeUtils,
  SidebarMode
> => {
  const { data: isDeviceLargerThanXl } = useIsDeviceLargerThanXl();
  const { data: editorMode } = useEditorMode();
  const { data: isCollapsedModeUnderDockMode } = usePreferCollapsedMode();

  const condition =
    isDeviceLargerThanXl != null &&
    editorMode != null &&
    isCollapsedModeUnderDockMode != null;

  const isEditorMode = editorMode === EditorMode.Editor;

  const fetcher = useCallback(
    ([, isDeviceLargerThanXl, isEditorMode, isCollapsedModeUnderDockMode]: [
      Key,
      boolean | undefined,
      boolean | undefined,
      boolean | undefined,
    ]) => {
      if (!isDeviceLargerThanXl) {
        return SidebarMode.DRAWER;
      }
      return isEditorMode || isCollapsedModeUnderDockMode
        ? SidebarMode.COLLAPSED
        : SidebarMode.DOCK;
    },
    [],
  );

  const swrResponse = useSWRImmutable(
    condition
      ? [
          'sidebarMode',
          isDeviceLargerThanXl,
          isEditorMode,
          isCollapsedModeUnderDockMode,
        ]
      : null,
    // calcDrawerMode,
    fetcher,
    {
      fallbackData: fetcher([
        'sidebarMode',
        isDeviceLargerThanXl,
        isEditorMode,
        isCollapsedModeUnderDockMode,
      ]),
    },
  );

  const _isDrawerMode = useCallback(
    () => swrResponse.data === SidebarMode.DRAWER,
    [swrResponse.data],
  );
  const _isCollapsedMode = useCallback(
    () => swrResponse.data === SidebarMode.COLLAPSED,
    [swrResponse.data],
  );
  const _isDockMode = useCallback(
    () => swrResponse.data === SidebarMode.DOCK,
    [swrResponse.data],
  );

  return {
    ...swrResponse,
    isDrawerMode: _isDrawerMode,
    isCollapsedMode: _isCollapsedMode,
    isDockMode: _isDockMode,
  };
};

export const useSelectedGrant = (
  initialData?: Nullable<IPageSelectedGrant>,
): SWRResponse<Nullable<IPageSelectedGrant>, Error> => {
  return useSWRStatic<Nullable<IPageSelectedGrant>, Error>(
    'selectedGrant',
    initialData,
    { fallbackData: { grant: PageGrant.GRANT_PUBLIC } },
  );
};

type PageTreeDescCountMapUtils = {
  update(
    newData?: UpdateDescCountData,
  ): Promise<UpdateDescCountData | undefined>;
  getDescCount(pageId?: string): number | null | undefined;
};

export const usePageTreeDescCountMap = (
  initialData?: UpdateDescCountData,
): SWRResponse<UpdateDescCountData, Error> & PageTreeDescCountMapUtils => {
  const key = 'pageTreeDescCountMap';

  const swrResponse = useStaticSWR<UpdateDescCountData, Error>(
    key,
    initialData,
    { fallbackData: new Map() },
  );

  return {
    ...swrResponse,
    getDescCount: (pageId?: string) =>
      pageId != null ? swrResponse.data?.get(pageId) : null,
    update: (newData: UpdateDescCountData) =>
      swrResponse.mutate(
        new Map([...(swrResponse.data || new Map()), ...newData]),
      ),
  };
};

type UseCommentEditorDirtyMapOperation = {
  evaluate(key: string, commentBody: string): Promise<number>;
  clean(key: string): Promise<number>;
};

export const useCommentEditorDirtyMap = (): SWRResponse<
  Map<string, boolean>,
  Error
> &
  UseCommentEditorDirtyMapOperation => {
  const router = useRouter();

  const swrResponse = useSWRStatic<Map<string, boolean>, Error>(
    'editingCommentsNum',
    undefined,
    { fallbackData: new Map() },
  );

  const { mutate } = swrResponse;

  const evaluate = useCallback(
    async (key: string, commentBody: string) => {
      const newMap = await mutate((map) => {
        if (map == null) return new Map();

        if (commentBody.length === 0) {
          map.delete(key);
        } else {
          map.set(key, true);
        }

        return map;
      });
      return newMap?.size ?? 0;
    },
    [mutate],
  );
  const clean = useCallback(
    async (key: string) => {
      const newMap = await mutate((map) => {
        if (map == null) return new Map();
        map.delete(key);
        return map;
      });
      return newMap?.size ?? 0;
    },
    [mutate],
  );

  const reset = useCallback(() => mutate(new Map()), [mutate]);

  useLayoutEffect(() => {
    router.events.on('routeChangeComplete', reset);
    return () => {
      router.events.off('routeChangeComplete', reset);
    };
  }, [reset, router.events]);

  return {
    ...swrResponse,
    evaluate,
    clean,
  };
};

/** **********************************************************
 *                          SWR Hooks
 *                Determined value by context
 *********************************************************** */

export const useIsAbleToShowTrashPageManagementButtons = (): SWRResponse<
  boolean,
  Error
> => {
  const key = 'isAbleToShowTrashPageManagementButtons';

  const { data: _currentUser } = useCurrentUser();
  const isCurrentUserExist = _currentUser != null;

  const { data: _currentPageId } = useCurrentPageId();
  const { data: _isNotFound } = useIsNotFound();
  const { data: _isTrashPage } = useIsTrashPage();
  const { data: _isReadOnlyUser } = useIsReadOnlyUser();
  const isPageExist = _currentPageId != null && _isNotFound === false;
  const isTrashPage = isPageExist && _isTrashPage === true;
  const isReadOnlyUser = isPageExist && _isReadOnlyUser === true;

  const includesUndefined = [
    _currentUser,
    _currentPageId,
    _isNotFound,
    _isReadOnlyUser,
    _isTrashPage,
  ].some((v) => v === undefined);

  return useSWRImmutable(
    includesUndefined
      ? null
      : [key, isTrashPage, isCurrentUserExist, isReadOnlyUser],
    ([, isTrashPage, isCurrentUserExist, isReadOnlyUser]) =>
      isTrashPage && isCurrentUserExist && !isReadOnlyUser,
  );
};

export const useIsAbleToShowPageManagement = (): SWRResponse<
  boolean,
  Error
> => {
  const key = 'isAbleToShowPageManagement';
  const { data: currentPageId } = useCurrentPageId();
  const { data: _isTrashPage } = useIsTrashPage();
  const { data: _isSharedUser } = useIsSharedUser();
  const { data: isNotFound } = useIsNotFound();

  const pageId = currentPageId;
  const includesUndefined = [
    pageId,
    _isTrashPage,
    _isSharedUser,
    isNotFound,
  ].some((v) => v === undefined);
  const isPageExist = pageId != null && isNotFound === false;
  const isEmptyPage = pageId != null && isNotFound === true;
  const isTrashPage = isPageExist && _isTrashPage === true;
  const isSharedUser = isPageExist && _isSharedUser === true;

  return useSWRImmutable(
    includesUndefined
      ? null
      : [key, pageId, isPageExist, isEmptyPage, isTrashPage, isSharedUser],
    ([, , isPageExist, isEmptyPage, isTrashPage, isSharedUser]) =>
      (isPageExist && !isTrashPage && !isSharedUser) || isEmptyPage,
  );
};

export const useIsAbleToShowTagLabel = (): SWRResponse<boolean, Error> => {
  const key = 'isAbleToShowTagLabel';
  const { data: pageId } = useCurrentPageId();
  const { data: currentPagePath } = useCurrentPagePath();
  const { data: isIdenticalPath } = useIsIdenticalPath();
  const { data: isNotFound } = useIsNotFound();
  const { data: editorMode } = useEditorMode();
  const { data: shareLinkId } = useShareLinkId();

  const includesUndefined = [
    currentPagePath,
    isIdenticalPath,
    isNotFound,
    editorMode,
  ].some((v) => v === undefined);

  const isViewMode = editorMode === EditorMode.View;

  return useSWRImmutable(
    includesUndefined
      ? null
      : [
          key,
          pageId,
          currentPagePath,
          isIdenticalPath,
          isNotFound,
          editorMode,
          shareLinkId,
        ],
    // "/trash" page does not exist on page collection and unable to add tags
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    () =>
      !isUsersTopPage(currentPagePath!) &&
      !isTrashTopPage(currentPagePath!) &&
      shareLinkId == null &&
      !isIdenticalPath &&
      !(isViewMode && isNotFound),
  );
};

export const useIsAbleToChangeEditorMode = (): SWRResponse<boolean, Error> => {
  const key = 'isAbleToChangeEditorMode';
  const { data: isEditable } = useIsEditable();
  const { data: isSharedUser } = useIsSharedUser();

  const includesUndefined = [isEditable, isSharedUser].some(
    (v) => v === undefined,
  );

  return useSWRImmutable(
    includesUndefined ? null : [key, isEditable, isSharedUser],
    () => !!isEditable && !isSharedUser,
  );
};

export const useIsAbleToShowPageAuthors = (): SWRResponse<boolean, Error> => {
  const key = 'isAbleToShowPageAuthors';
  const { data: pageId } = useCurrentPageId();
  const { data: pagePath } = useCurrentPagePath();
  const { data: isNotFound } = useIsNotFound();

  const includesUndefined = [pageId, pagePath, isNotFound].some(
    (v) => v === undefined,
  );
  const isPageExist = pageId != null && !isNotFound;
  const isUsersTopPagePath = pagePath != null && isUsersTopPage(pagePath);

  return useSWRImmutable(
    includesUndefined ? null : [key, pageId, pagePath, isNotFound],
    () => isPageExist && !isUsersTopPagePath,
  );
};

export const useIsUntitledPage = (): SWRResponse<boolean> => {
  const key = 'isUntitledPage';

  const { data: pageId } = useCurrentPageId();

  return useSWRStatic(pageId == null ? null : [key, pageId], undefined, {
    fallbackData: false,
  });
};
