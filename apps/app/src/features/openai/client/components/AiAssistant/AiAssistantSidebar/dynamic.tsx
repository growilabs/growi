import type { FC } from 'react';
import { memo } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';

import { useAiAssistantSidebarStatus } from '../../../states';

export const AiAssistantSidebarLazyLoaded: FC = memo(() => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const isOpened = aiAssistantSidebarData?.isOpened ?? false;

  const ComponentToRender = useLazyLoader(
    'ai-assistant-sidebar',
    () =>
      import('./AiAssistantSidebar').then((mod) => ({
        default: mod.AiAssistantSidebar,
      })),
    isOpened,
  );

  if (ComponentToRender == null) {
    return null;
  }

  return <ComponentToRender />;
});

AiAssistantSidebarLazyLoaded.displayName = 'AiAssistantSidebarLazyLoaded';
