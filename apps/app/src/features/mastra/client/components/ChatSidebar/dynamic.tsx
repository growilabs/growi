import { type FC, memo } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';

import { useChatSidebarStatus } from '../../status/chat-sidebar';

export const ChatSidebarLazyLoaded: FC = memo(() => {
  const chatSidebarStatus = useChatSidebarStatus();
  const isOpened = chatSidebarStatus?.isOpened ?? false;

  const ComponentToRender = useLazyLoader(
    'chat-sidebar',
    () =>
      import('./ChatSidebar').then((mod) => ({
        default: mod.ChatSidebar,
      })),
    isOpened,
  );

  if (ComponentToRender == null || !isOpened) {
    return null;
  }

  // Force a fresh mount when the active thread changes so the
  // session-scoped thread id inside ChatSidebar is regenerated.
  // A new chat (no threadId) mounts under a stable 'new' key.
  const remountKey = chatSidebarStatus?.threadId ?? 'new';

  return <ComponentToRender key={remountKey} />;
});
