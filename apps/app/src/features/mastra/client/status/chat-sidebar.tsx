import { useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';

/**
 * Type definition for Chat Sidebar status
 */
export type ChatSidebarStatus = {
  isOpened: boolean;
  threadId?: string;
  /**
   * Monotonically increasing counter bumped on every `openChat()` call.
   *
   * A new chat carries no `threadId`, so consumers cannot distinguish one new
   * chat from the next by id alone. This sequence lets the chat sidebar force a
   * fresh mount (and thus a freshly minted session thread id) every time the
   * user starts a new chat, even back-to-back.
   *
   * It has two consumers, so keep it bumped on *every* open:
   * - `dynamic.tsx` — remount key for a new chat (see above).
   * - `ChatSidebar` — trigger for handing the caret to the prompt input. This
   *   one also covers re-opening the thread that is already displayed, where
   *   the remount key is unchanged and no fresh mount happens.
   */
  openSeq: number;
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
  openSeq: 0,
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
      setSidebar((prev) => ({
        isOpened: true,
        threadId,
        openSeq: prev.openSeq + 1,
      }));
    },
    [setSidebar],
  );

  const close = useCallback(() => {
    setSidebar((prev) => ({
      isOpened: false,
      threadId: undefined,
      openSeq: prev.openSeq,
    }));
  }, [setSidebar]);

  return {
    openChat,
    close,
  };
};
