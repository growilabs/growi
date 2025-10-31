import { useCallback } from 'react';
import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';

import type {
  AccessibleAiAssistantsHasId,
  AiAssistantHasId,
} from '../../interfaces/ai-assistant';
import type { IThreadRelationHasId } from '../../interfaces/thread-relation'; // IThreadHasId を削除

/*
 *  useAiAssistantManagementModal
 */
export const AiAssistantManagementModalPageMode = {
  HOME: 'home',
  SHARE: 'share',
  PAGES: 'pages',
  INSTRUCTION: 'instruction',
  PAGE_SELECTION_METHOD: 'page-selection-method',
  KEYWORD_SEARCH: 'keyword-search',
  PAGE_TREE_SELECTION: 'page-tree-selection',
} as const;

export type AiAssistantManagementModalPageMode =
  (typeof AiAssistantManagementModalPageMode)[keyof typeof AiAssistantManagementModalPageMode];

type AiAssistantManagementModalStatus = {
  isOpened: boolean;
  pageMode?: AiAssistantManagementModalPageMode;
  aiAssistantData?: AiAssistantHasId;
};

type AiAssistantManagementModalUtils = {
  open(aiAssistantData?: AiAssistantHasId): void;
  close(): void;
  changePageMode(pageType: AiAssistantManagementModalPageMode): void;
};

export const useAiAssistantManagementModal = (
  status?: AiAssistantManagementModalStatus,
): SWRResponse<AiAssistantManagementModalStatus, Error> &
  AiAssistantManagementModalUtils => {
  const initialStatus = {
    isOpened: false,
    pageType: AiAssistantManagementModalPageMode.HOME,
  };
  const swrResponse = useSWRStatic<AiAssistantManagementModalStatus, Error>(
    'AiAssistantManagementModal',
    status,
    { fallbackData: initialStatus },
  );

  return {
    ...swrResponse,
    open: useCallback(
      (aiAssistantData) => {
        swrResponse.mutate({
          isOpened: true,
          aiAssistantData,
          pageMode:
            aiAssistantData != null
              ? AiAssistantManagementModalPageMode.HOME
              : AiAssistantManagementModalPageMode.PAGE_SELECTION_METHOD,
        });
      },
      [swrResponse],
    ),
    close: useCallback(
      () => swrResponse.mutate({ isOpened: false, aiAssistantData: undefined }),
      [swrResponse],
    ),
    changePageMode: useCallback(
      (pageMode: AiAssistantManagementModalPageMode) => {
        swrResponse.mutate({
          isOpened: swrResponse.data?.isOpened ?? false,
          pageMode,
          aiAssistantData: swrResponse.data?.aiAssistantData,
        });
      },
      [swrResponse],
    ),
  };
};

export const useSWRxAiAssistants = (): SWRResponse<
  AccessibleAiAssistantsHasId,
  Error
> => {
  return useSWRImmutable<AccessibleAiAssistantsHasId>(
    ['/openai/ai-assistants'],
    ([endpoint]) =>
      apiv3Get(endpoint).then(
        (response) => response.data.accessibleAiAssistants,
      ),
  );
};

/*
 *  useAiAssistantSidebar
 */
type AiAssistantSidebarStatus = {
  isOpened: boolean;
  isEditorAssistant?: boolean;
  aiAssistantData?: AiAssistantHasId;
  threadData?: IThreadRelationHasId;
};

type AiAssistantSidebarUtils = {
  openChat(
    aiAssistantData: AiAssistantHasId,
    threadData?: IThreadRelationHasId,
  ): void;
  openEditor(): void;
  close(): void;
  refreshAiAssistantData(aiAssistantData?: AiAssistantHasId): void;
  refreshThreadData(threadData?: IThreadRelationHasId): void;
};

export const useAiAssistantSidebar = (
  status?: AiAssistantSidebarStatus,
): SWRResponse<AiAssistantSidebarStatus, Error> & AiAssistantSidebarUtils => {
  const initialStatus = { isOpened: false };
  const swrResponse = useSWRStatic<AiAssistantSidebarStatus, Error>(
    'AiAssistantSidebar',
    status,
    { fallbackData: initialStatus },
  );

  return {
    ...swrResponse,
    openChat: useCallback(
      (
        aiAssistantData: AiAssistantHasId,
        threadData?: IThreadRelationHasId,
      ) => {
        swrResponse.mutate({ isOpened: true, aiAssistantData, threadData });
      },
      [swrResponse],
    ),
    openEditor: useCallback(() => {
      swrResponse.mutate({
        isOpened: true,
        isEditorAssistant: true,
        aiAssistantData: undefined,
        threadData: undefined,
      });
    }, [swrResponse]),
    close: useCallback(
      () =>
        swrResponse.mutate({
          isOpened: false,
          isEditorAssistant: false,
          aiAssistantData: undefined,
          threadData: undefined,
        }),
      [swrResponse],
    ),
    refreshAiAssistantData: useCallback(
      (aiAssistantData) => {
        swrResponse.mutate((currentState = { isOpened: false }) => {
          return { ...currentState, aiAssistantData };
        });
      },
      [swrResponse],
    ),
    refreshThreadData: useCallback(
      (threadData?: IThreadRelationHasId) => {
        swrResponse.mutate((currentState = { isOpened: false }) => {
          return { ...currentState, threadData };
        });
      },
      [swrResponse],
    ),
  };
};
