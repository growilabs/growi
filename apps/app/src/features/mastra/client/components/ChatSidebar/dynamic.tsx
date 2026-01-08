import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';

export const ChatSidebarLazyLoaded = (): JSX.Element => {
  const isOpen = true;

  const ChatSidebar = useLazyLoader(
    'ChatSidebar',
    () =>
      import('./ChatSidebar').then((mod) => ({
        default: mod.ChatSidebar,
      })),
    isOpen,
  );

  return ChatSidebar ? <ChatSidebar /> : <></>;
};
