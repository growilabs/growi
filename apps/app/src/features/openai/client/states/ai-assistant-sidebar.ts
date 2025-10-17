import { useCallback } from 'react';

import { atom, useAtomValue, useSetAtom } from 'jotai';

import { type AiAssistantHasId } from '../../interfaces/ai-assistant';
import type { IThreadRelationHasId } from '../../interfaces/thread-relation';

/**
 * Type definition for AI Assistant Sidebar status
 */
export type AiAssistantSidebarStatus = {
  isOpened: boolean;
  isEditorAssistant?: boolean;
  aiAssistantData?: AiAssistantHasId;
  threadData?: IThreadRelationHasId;
};

/**
 * Type definition for AI Assistant Sidebar actions
 */
export type AiAssistantSidebarActions = {
  openChat: (aiAssistantData: AiAssistantHasId, threadData?: IThreadRelationHasId) => void;
  openEditor: () => void;
  close: () => void;
  refreshAiAssistantData: (aiAssistantData?: AiAssistantHasId) => void;
  refreshThreadData: (threadData?: IThreadRelationHasId) => void;
};

/**
 * Atom for managing AI Assistant Sidebar state
 */
const aiAssistantSidebarAtom = atom<AiAssistantSidebarStatus>({
  isOpened: false,
});

/**
 * Hook to get the AI Assistant Sidebar status
 * @returns The current AI Assistant Sidebar status
 */
export const useAiAssistantSidebarStatus = (): AiAssistantSidebarStatus => {
  return useAtomValue(aiAssistantSidebarAtom);
};

/**
 * Hook to get the AI Assistant Sidebar actions
 * @returns Actions for managing the AI Assistant Sidebar
 */
export const useAiAssistantSidebarActions = (): AiAssistantSidebarActions => {
  const setSidebar = useSetAtom(aiAssistantSidebarAtom);

  const openChat = useCallback(
    (aiAssistantData: AiAssistantHasId, threadData?: IThreadRelationHasId) => {
      setSidebar({ isOpened: true, aiAssistantData, threadData });
    },
    [setSidebar],
  );

  const openEditor = useCallback(() => {
    setSidebar({
      isOpened: true,
      isEditorAssistant: true,
      aiAssistantData: undefined,
      threadData: undefined,
    });
  }, [setSidebar]);

  const close = useCallback(() => {
    setSidebar({
      isOpened: false,
      isEditorAssistant: false,
      aiAssistantData: undefined,
      threadData: undefined,
    });
  }, [setSidebar]);

  const refreshAiAssistantData = useCallback(
    (aiAssistantData?: AiAssistantHasId) => {
      setSidebar((currentState) => {
        return { ...currentState, aiAssistantData };
      });
    },
    [setSidebar],
  );

  const refreshThreadData = useCallback(
    (threadData?: IThreadRelationHasId) => {
      setSidebar((currentState) => {
        return { ...currentState, threadData };
      });
    },
    [setSidebar],
  );

  return {
    openChat,
    openEditor,
    close,
    refreshAiAssistantData,
    refreshThreadData,
  };
};
