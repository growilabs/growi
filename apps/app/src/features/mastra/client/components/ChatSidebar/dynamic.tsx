import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useAiAssistantSidebarStatus } from '~/features/openai/client/states';

export const ChatSidebarLazyLoaded = (): JSX.Element => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const isOpened = aiAssistantSidebarData?.isOpened ?? false;

  const ChatSidebar = useLazyLoader(
    'ChatSidebar',
    () =>
      import('./ChatSidebar').then((mod) => ({
        default: mod.ChatSidebar,
      })),
    isOpened,
  );

  return ChatSidebar ? <ChatSidebar /> : <></>;
};
