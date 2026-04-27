import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

import type { AiAssistantHasId } from '~/features/openai/interfaces/ai-assistant';
// import type { IThreadRelationHasId } from '../../interfaces/thread-relation';

/**
 * Type definition for Chat Sidebar status
 */
export type ChatSidebarStatus = {
  isOpened: boolean;
  isEditorAssistant?: boolean;
  aiAssistantData?: AiAssistantHasId;
  threadId?: string;
};

/**
 * Type definition for Chat Sidebar actions
 */
export type ChatSidebarActions = {
  openChat: (aiAssistantData: AiAssistantHasId, threadId?: string) => void;
  openEditor: () => void;
  close: () => void;
  // refreshAiAssistantData: (aiAssistantData?: AiAssistantHasId) => void;
  // refreshThreadData: (threadData?: IThreadRelationHasId) => void;
};

/**
 * Atom for managing Chat Sidebar state
 */
const chatSidebarAtom = atom<ChatSidebarStatus>({
  isOpened: false,
});

/**
 * Hook to get the Chat Sidebar status
 * @returns The current Chat Sidebar status
 */
export const useChatSidebarStatus = (): ChatSidebarStatus => {
  return useAtomValue(chatSidebarAtom);
};

/**
 * Hook to get the Chat Sidebar actions
 * @returns Actions for managing the Chat Sidebar
 */
export const useChatSidebarActions = (): ChatSidebarActions => {
  const setSidebar = useSetAtom(chatSidebarAtom);

  const openChat = useCallback(
    (aiAssistantData: AiAssistantHasId, threadId?: string) => {
      setSidebar({ isOpened: true, aiAssistantData, threadId });
    },
    [setSidebar],
  );

  const openEditor = useCallback(() => {
    setSidebar({
      isOpened: true,
      isEditorAssistant: true,
      aiAssistantData: undefined,
    });
  }, [setSidebar]);

  const close = useCallback(() => {
    setSidebar({
      isOpened: false,
      isEditorAssistant: false,
      aiAssistantData: undefined,
      threadId: undefined,
    });
  }, [setSidebar]);

  // const refreshAiAssistantData = useCallback(
  //   (aiAssistantData?: AiAssistantHasId) => {
  //     setSidebar((currentState) => {
  //       return { ...currentState, aiAssistantData };
  //     });
  //   },
  //   [setSidebar],
  // );

  // const refreshThreadData = useCallback(
  //   (threadData?: IThreadRelationHasId) => {
  //     setSidebar((currentState) => {
  //       return { ...currentState, threadData };
  //     });
  //   },
  //   [setSidebar],
  // );

  return {
    openChat,
    openEditor,
    close,
    // refreshAiAssistantData,
    // refreshThreadData,
  };
};
