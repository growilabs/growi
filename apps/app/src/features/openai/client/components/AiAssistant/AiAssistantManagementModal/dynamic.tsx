import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';

import { useAiAssistantManagementModalStatus } from '../../../states/modal/ai-assistant-management';

type AiAssistantManagementModalProps = Record<string, unknown>;

export const AiAssistantManagementModalLazyLoaded = (): JSX.Element => {
  const status = useAiAssistantManagementModalStatus();

  const AiAssistantManagementModal =
    useLazyLoader<AiAssistantManagementModalProps>(
      'ai-assistant-management-modal',
      () =>
        import('./AiAssistantManagementModal').then((mod) => ({
          default: mod.AiAssistantManagementModal,
        })),
      status?.isOpened ?? false,
    );

  return AiAssistantManagementModal ? <AiAssistantManagementModal /> : <></>;
};
