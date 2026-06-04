import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

/**
 * Type definition for Chat Sidebar status
 */
export type ChatSidebarStatus = {
  isOpened: boolean;
  threadId?: string;
};

/**
 * Type definition for Chat Sidebar actions
 */
export type ChatSidebarActions = {
  /**
   * Open the chat sidebar.
   * @param threadId - Optional thread id to resume an existing thread.
   *                    Omit to start a fresh chat.
   */
  openChat: (threadId?: string) => void;
  close: () => void;
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
    (threadId?: string) => {
      setSidebar({ isOpened: true, threadId });
    },
    [setSidebar],
  );

  const close = useCallback(() => {
    setSidebar({
      isOpened: false,
      threadId: undefined,
    });
  }, [setSidebar]);

  return {
    openChat,
    close,
  };
};
