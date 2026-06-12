import type { FC } from 'react';
import { memo } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';

import { useAiAssistantSidebarStatus } from '../../../states/index.js';

export const AiAssistantSidebarLazyLoaded: FC = memo(() => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const isOpened = aiAssistantSidebarData?.isOpened ?? false;

  const ComponentToRender = useLazyLoader(
    'ai-assistant-sidebar',
    () =>
      import('./AiAssistantSidebar.js').then((mod) => ({
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
