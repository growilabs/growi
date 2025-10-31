import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { AiAssistantHasId } from '../../../interfaces/ai-assistant';

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

export type AiAssistantManagementModalStatus = {
  isOpened: boolean;
  pageMode?: AiAssistantManagementModalPageMode;
  aiAssistantData?: AiAssistantHasId;
};

export type AiAssistantManagementModalActions = {
  open: (aiAssistantData?: AiAssistantHasId) => void;
  close: () => void;
  changePageMode: (pageMode: AiAssistantManagementModalPageMode) => void;
};

// Atom definition
const aiAssistantManagementModalAtom = atom<AiAssistantManagementModalStatus>({
  isOpened: false,
  pageMode: AiAssistantManagementModalPageMode.HOME,
  aiAssistantData: undefined,
});

// Read-only hook (useAtomValue)
export const useAiAssistantManagementModalStatus =
  (): AiAssistantManagementModalStatus => {
    return useAtomValue(aiAssistantManagementModalAtom);
  };

// Actions hook (useSetAtom + useCallback)
export const useAiAssistantManagementModalActions =
  (): AiAssistantManagementModalActions => {
    const setStatus = useSetAtom(aiAssistantManagementModalAtom);

    const open = useCallback(
      (aiAssistantData?: AiAssistantHasId) => {
        setStatus({
          isOpened: true,
          aiAssistantData,
          pageMode:
            aiAssistantData != null
              ? AiAssistantManagementModalPageMode.HOME
              : AiAssistantManagementModalPageMode.PAGE_SELECTION_METHOD,
        });
      },
      [setStatus],
    );

    const close = useCallback(() => {
      setStatus({
        isOpened: false,
        aiAssistantData: undefined,
        pageMode: AiAssistantManagementModalPageMode.HOME,
      });
    }, [setStatus]);

    const changePageMode = useCallback(
      (pageMode: AiAssistantManagementModalPageMode) => {
        setStatus((current) => ({
          ...current,
          pageMode,
        }));
      },
      [setStatus],
    );

    return { open, close, changePageMode };
  };
