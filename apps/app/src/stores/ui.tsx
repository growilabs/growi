import {
  type RefObject, useCallback, useEffect,
  useLayoutEffect,
} from 'react';

import { PageGrant, type Nullable } from '@growi/core';
import { type SWRResponseWithUtils, useSWRStatic, withUtils } from '@growi/core/dist/swr';
import { pagePathUtils, isClient, isServer } from '@growi/core/dist/utils';
import { Breakpoint } from '@growi/ui/dist/interfaces';
import { addBreakpointListener, cleanupBreakpointListener } from '@growi/ui/dist/utils';
import { useRouter } from 'next/router';
import type { HtmlElementNode } from 'rehype-toc';
import type SimpleBar from 'simplebar-react';
import type { MutatorOptions } from 'swr';
import {
  useSWRConfig, type SWRResponse, type Key,
} from 'swr';
import useSWRImmutable from 'swr/immutable';

import { scheduleToPut } from '~/client/services/user-ui-settings';
import type { IPageSelectedGrant } from '~/interfaces/page';
import { SidebarContentsType, SidebarMode } from '~/interfaces/ui';
import type { UpdateDescCountData } from '~/interfaces/websocket';
import {
  useIsNotFound, useCurrentPagePath, useIsTrashPage, useCurrentPageId,
} from '~/stores/page';
import loggerFactory from '~/utils/logger';

import {
  useIsEditable, useIsReadOnlyUser,
  useIsSharedUser, useIsIdenticalPath, useCurrentUser, useShareLinkId,
} from './context';
import { useStaticSWR } from './use-static-swr';

const { isTrashTopPage, isUsersTopPage } = pagePathUtils;

const logger = loggerFactory('growi:stores:ui');


/** **********************************************************
 *                          Unions
 *********************************************************** */

export const EditorMode = {
  View: 'view',
  Editor: 'editor',
} as const;
export type EditorMode = typeof EditorMode[keyof typeof EditorMode];


/** **********************************************************
 *                     Storing objects to ref
 *********************************************************** */

export const useSidebarScrollerRef = (initialData?: RefObject<SimpleBar>): SWRResponse<RefObject<SimpleBar>, Error> => {
  return useStaticSWR<RefObject<SimpleBar>, Error>('sidebarScrollerRef', initialData);
};

export const useCurrentPageTocNode = (): SWRResponse<HtmlElementNode, any> => {
  const { data: currentPagePath } = useCurrentPagePath();

  return useStaticSWR(['currentPageTocNode', currentPagePath]);
};

/** **********************************************************
 *                          SWR Hooks
 *                      for switching UI
 *********************************************************** */

export const useIsMobile = (): SWRResponse<boolean, Error> => {
  const key = isClient() ? 'isMobile' : null;

  let configuration;
  if (isClient()) {
    const userAgent = window.navigator.userAgent.toLowerCase();
    configuration = {
      fallbackData: /iphone|ipad|android/.test(userAgent),
    };
  }

  return useStaticSWR<boolean, Error>(key, undefined, configuration);
};

const getClassNamesByEditorMode = (editorMode: EditorMode | undefined): string[] => {
  const classNames: string[] = [];
  switch (editorMode) {
    case EditorMode.Editor:
      classNames.push('editing', 'builtin-editor');
      break;
  }

  return classNames;
};

export const EditorModeHash = {
  View: '',
  Edit: '#edit',
} as const;
export type EditorModeHash = typeof EditorModeHash[keyof typeof EditorModeHash];

const updateHashByEditorMode = (newEditorMode: EditorMode) => {
  const { pathname, search } = window.location;

  switch (newEditorMode) {
    case EditorMode.View:
      window.history.replaceState(null, '', `${pathname}${search}${EditorModeHash.View}`);
      break;
    case EditorMode.Editor:
      window.history.replaceState(null, '', `${pathname}${search}${EditorModeHash.Edit}`);
      break;
  }
};

export const determineEditorModeByHash = (): EditorMode => {
  if (isServer()) {
    return EditorMode.View;
  }

  const { hash } = window.location;

  switch (hash) {
    case EditorModeHash.Edit:
      return EditorMode.Editor;
    default:
      return EditorMode.View;
  }
};

type EditorModeUtils = {
  getClassNamesByEditorMode: () => string[],
}

export const useEditorMode = (): SWRResponseWithUtils<EditorModeUtils, EditorMode> => {
  const { data: _isEditable } = useIsEditable();
  const { data: isNotFound } = useIsNotFound();

  const editorModeByHash = determineEditorModeByHash();

  const isLoading = _isEditable === undefined;
  const isEditable = !isLoading && _isEditable;
  const preventModeEditor = !isEditable || isNotFound === undefined || isNotFound === true;
  const initialData = preventModeEditor ? EditorMode.View : editorModeByHash;

  const swrResponse = useSWRImmutable(
    isLoading ? null : ['editorMode', isEditable, preventModeEditor],
    null,
    { fallbackData: initialData },
  );

  // construct overriding mutate method
  const mutateOriginal = swrResponse.mutate;
  const mutate = useCallback((editorMode: EditorMode, shouldRevalidate?: boolean) => {
    if (preventModeEditor) {
      return Promise.resolve(EditorMode.View); // fixed if not editable
    }
    updateHashByEditorMode(editorMode);
    return mutateOriginal(editorMode, shouldRevalidate);
  }, [preventModeEditor, mutateOriginal]);

  const getClassNames = useCallback(() => {
    return getClassNamesByEditorMode(swrResponse.data);
  }, [swrResponse.data]);

  return Object.assign(swrResponse, {
    mutate,
    getClassNamesByEditorMode: getClassNames,
  });
};

export const useIsDeviceLargerThanMd = (): SWRResponse<boolean, Error> => {
  const key: Key = isClient() ? 'isDeviceLargerThanMd' : null;

  const { cache, mutate } = useSWRConfig();

  useEffect(() => {
    if (key != null) {
      const mdOrAvobeHandler = function(this: MediaQueryList): void {
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
      const lgOrAvobeHandler = function(this: MediaQueryList): void {
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
      const xlOrAvobeHandler = function(this: MediaQueryList): void {
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


type MutateAndSaveUserUISettings<Data> = (data: Data, opts?: boolean | MutatorOptions<Data>) => Promise<Data | undefined>;
type MutateAndSaveUserUISettingsUtils<Data> = {
  mutateAndSave: MutateAndSaveUserUISettings<Data>;
}

export const useCurrentSidebarContents = (
    initialData?: SidebarContentsType,
): SWRResponseWithUtils<MutateAndSaveUserUISettingsUtils<SidebarContentsType>, SidebarContentsType> => {
  const swrResponse = useSWRStatic('sidebarContents', initialData, { fallbackData: SidebarContentsType.TREE });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<SidebarContentsType> = useCallback((data, opts?) => {
    scheduleToPut({ currentSidebarContents: data });
    return mutate(data, opts);
  }, [mutate]);

  return withUtils(swrResponse, { mutateAndSave });
};

export const usePageControlsX = (
    initialData?: number,
): SWRResponseWithUtils<MutateAndSaveUserUISettingsUtils<number>, number> => {
  const swrResponse = useSWRStatic('pageControlsX', initialData, { fallbackData: 1000 });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<number> = useCallback((data, opt?) => {
    scheduleToPut({ currentPageControlsX: data });
    return mutate(data, opt);
  }, [mutate]);

  return withUtils(swrResponse, { mutateAndSave });
};

export const useCurrentProductNavWidth = (initialData?: number): SWRResponseWithUtils<MutateAndSaveUserUISettingsUtils<number>, number> => {
  const swrResponse = useSWRStatic('productNavWidth', initialData, { fallbackData: 320 });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<number> = useCallback((data, opts?) => {
    scheduleToPut({ currentProductNavWidth: data });
    return mutate(data, opts);
  }, [mutate]);

  return withUtils(swrResponse, { mutateAndSave });
};

export const usePreferCollapsedMode = (initialData?: boolean): SWRResponseWithUtils<MutateAndSaveUserUISettingsUtils<boolean>, boolean> => {
  const swrResponse = useSWRStatic('isPreferCollapsedMode', initialData, { fallbackData: false });

  const { mutate } = swrResponse;

  const mutateAndSave: MutateAndSaveUserUISettings<boolean> = useCallback((data, opts?) => {
    scheduleToPut({ preferCollapsedModeByUser: data });
    return mutate(data, opts);
  }, [mutate]);

  return withUtils(swrResponse, { mutateAndSave });
};

export const useCollapsedContentsOpened = (initialData?: boolean): SWRResponse<boolean> => {
  return useSWRStatic('isCollapsedContentsOpened', initialData, { fallbackData: false });
};

export const useDrawerOpened = (isOpened?: boolean): SWRResponse<boolean, Error> => {
  return useSWRStatic('isDrawerOpened', isOpened, { fallbackData: false });
};

type DetectSidebarModeUtils = {
  isDrawerMode(): boolean
  isCollapsedMode(): boolean
  isDockMode(): boolean
}

export const useSidebarMode = (): SWRResponseWithUtils<DetectSidebarModeUtils, SidebarMode> => {
  const { data: isDeviceLargerThanXl } = useIsDeviceLargerThanXl();
  const { data: editorMode } = useEditorMode();
  const { data: isCollapsedModeUnderDockMode } = usePreferCollapsedMode();

  const condition = isDeviceLargerThanXl != null && editorMode != null && isCollapsedModeUnderDockMode != null;

  const isEditorMode = editorMode === EditorMode.Editor;

  const fetcher = useCallback((
      [, isDeviceLargerThanXl, isEditorMode, isCollapsedModeUnderDockMode]: [Key, boolean|undefined, boolean|undefined, boolean|undefined],
  ) => {
    if (!isDeviceLargerThanXl) {
      return SidebarMode.DRAWER;
    }
    return isEditorMode || isCollapsedModeUnderDockMode ? SidebarMode.COLLAPSED : SidebarMode.DOCK;
  }, []);

  const swrResponse = useSWRImmutable(
    condition ? ['sidebarMode', isDeviceLargerThanXl, isEditorMode, isCollapsedModeUnderDockMode] : null,
    // calcDrawerMode,
    fetcher,
    { fallbackData: fetcher(['sidebarMode', isDeviceLargerThanXl, isEditorMode, isCollapsedModeUnderDockMode]) },
  );

  const _isDrawerMode = useCallback(() => swrResponse.data === SidebarMode.DRAWER, [swrResponse.data]);
  const _isCollapsedMode = useCallback(() => swrResponse.data === SidebarMode.COLLAPSED, [swrResponse.data]);
  const _isDockMode = useCallback(() => swrResponse.data === SidebarMode.DOCK, [swrResponse.data]);

  return {
    ...swrResponse,
    isDrawerMode: _isDrawerMode,
    isCollapsedMode: _isCollapsedMode,
    isDockMode: _isDockMode,
  };
};

export const useSelectedGrant = (initialData?: Nullable<IPageSelectedGrant>): SWRResponse<Nullable<IPageSelectedGrant>, Error> => {
  return useSWRStatic<Nullable<IPageSelectedGrant>, Error>('selectedGrant', initialData, { fallbackData: { grant: PageGrant.GRANT_PUBLIC } });
};

type PageTreeDescCountMapUtils = {
  update(newData?: UpdateDescCountData): Promise<UpdateDescCountData | undefined>
  getDescCount(pageId?: string): number | null | undefined
}

export const usePageTreeDescCountMap = (initialData?: UpdateDescCountData): SWRResponse<UpdateDescCountData, Error> & PageTreeDescCountMapUtils => {
  const key = 'pageTreeDescCountMap';

  const swrResponse = useStaticSWR<UpdateDescCountData, Error>(key, initialData, { fallbackData: new Map() });

  return {
    ...swrResponse,
    getDescCount: (pageId?: string) => (pageId != null ? swrResponse.data?.get(pageId) : null),
    update: (newData: UpdateDescCountData) => swrResponse.mutate(new Map([...(swrResponse.data || new Map()), ...newData])),
  };
};


type UseCommentEditorDirtyMapOperation = {
  evaluate(key: string, commentBody: string): Promise<number>,
  clean(key: string): Promise<number>,
}

export const useCommentEditorDirtyMap = (): SWRResponse<Map<string, boolean>, Error> & UseCommentEditorDirtyMapOperation => {
  const router = useRouter();

  const swrResponse = useSWRStatic<Map<string, boolean>, Error>('editingCommentsNum', undefined, { fallbackData: new Map() });

  const { mutate } = swrResponse;

  const evaluate = useCallback(async(key: string, commentBody: string) => {
    const newMap = await mutate((map) => {
      if (map == null) return new Map();

      if (commentBody.length === 0) {
        map.delete(key);
      }
      else {
        map.set(key, true);
      }

      return map;
    });
    return newMap?.size ?? 0;
  }, [mutate]);
  const clean = useCallback(async(key: string) => {
    const newMap = await mutate((map) => {
      if (map == null) return new Map();
      map.delete(key);
      return map;
    });
    return newMap?.size ?? 0;
  }, [mutate]);

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

export const useIsAbleToShowTrashPageManagementButtons = (): SWRResponse<boolean, Error> => {
  const { data: currentUser } = useCurrentUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: isTrashPage } = useIsTrashPage();

  return useStaticSWR('isAbleToShowTrashPageManagementButtons', isTrashPage && currentUser != null && !isReadOnlyUser);
};

export const useIsAbleToShowPageManagement = (): SWRResponse<boolean, Error> => {
  const key = 'isAbleToShowPageManagement';
  const { data: currentPageId } = useCurrentPageId();
  const { data: _isTrashPage } = useIsTrashPage();
  const { data: _isSharedUser } = useIsSharedUser();
  const { data: isNotFound } = useIsNotFound();

  const pageId = currentPageId;
  const includesUndefined = [pageId, _isTrashPage, _isSharedUser, isNotFound].some(v => v === undefined);
  const isPageExist = (pageId != null) && isNotFound === false;
  const isEmptyPage = (pageId != null) && isNotFound === true;
  const isTrashPage = isPageExist && _isTrashPage === true;
  const isSharedUser = isPageExist && _isSharedUser === true;

  return useSWRImmutable(
    includesUndefined ? null : [key, pageId, isPageExist, isEmptyPage, isTrashPage, isSharedUser],
    ([, , isPageExist, isEmptyPage, isTrashPage, isSharedUser]) => (isPageExist && !isTrashPage && !isSharedUser) || isEmptyPage,
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

  const includesUndefined = [currentPagePath, isIdenticalPath, isNotFound, editorMode].some(v => v === undefined);

  const isViewMode = editorMode === EditorMode.View;

  return useSWRImmutable(
    includesUndefined ? null : [key, pageId, currentPagePath, isIdenticalPath, isNotFound, editorMode, shareLinkId],
    // "/trash" page does not exist on page collection and unable to add tags
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    () => !isUsersTopPage(currentPagePath!) && !isTrashTopPage(currentPagePath!) && shareLinkId == null && !isIdenticalPath && !(isViewMode && isNotFound),
  );
};

export const useIsAbleToChangeEditorMode = (): SWRResponse<boolean, Error> => {
  const key = 'isAbleToChangeEditorMode';
  const { data: isEditable } = useIsEditable();
  const { data: isSharedUser } = useIsSharedUser();

  const includesUndefined = [isEditable, isSharedUser].some(v => v === undefined);

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

  const includesUndefined = [pageId, pagePath, isNotFound].some(v => v === undefined);
  const isPageExist = (pageId != null) && !isNotFound;
  const isUsersTopPagePath = pagePath != null && isUsersTopPage(pagePath);

  return useSWRImmutable(
    includesUndefined ? null : [key, pageId, pagePath, isNotFound],
    () => isPageExist && !isUsersTopPagePath,
  );
};
