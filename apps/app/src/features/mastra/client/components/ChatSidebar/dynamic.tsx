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

  if (ComponentToRender == null) {
    return null;
  }

  return <ComponentToRender />;
});
