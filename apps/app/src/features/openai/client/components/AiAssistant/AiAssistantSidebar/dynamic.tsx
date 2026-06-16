import type { FC } from 'react';
import { memo } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useAiAssistantSidebarStatus } from '~/features/openai/client/states';

export const AiAssistantSidebarLazyLoaded: FC = memo(() => {
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const isOpened = aiAssistantSidebarData?.isOpened ?? false;

  const ComponentToRender = useLazyLoader(
    'ai-assistant-sidebar',
    () =>
      import(
        '~/features/openai/client/components/AiAssistant/AiAssistantSidebar/AiAssistantSidebar'
      ).then((mod) => ({
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
