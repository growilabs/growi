import { type FC, memo } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useAiAssistantSidebarStatus } from '~/features/openai/client/states';

export const ChatSidebarLazyLoaded: FC = memo(() => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const isOpened = aiAssistantSidebarData?.isOpened ?? false;

  const ComponentToRender = useLazyLoader(
    'chat-sidebar',
    () =>
      import('./ChatSidebar').then((mod) => ({
        default: mod.ChatSidebar,
      })),
    isOpened,
  );

  if (ComponentToRender == null) {
    return null;
  }

  return <ComponentToRender />;
});
