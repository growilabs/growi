import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';

import type { DeleteAiAssistantModalProps } from './DeleteAiAssistantModal';

export const DeleteAiAssistantModalLazyLoaded = (
  props: DeleteAiAssistantModalProps,
): JSX.Element => {
  const { isShown } = props;

  const DeleteAiAssistantModal = useLazyLoader<DeleteAiAssistantModalProps>(
    'delete-ai-assistant-modal',
    () =>
      import('./DeleteAiAssistantModal').then((mod) => ({
        default: mod.DeleteAiAssistantModal,
      })),
    isShown,
  );

  return DeleteAiAssistantModal ? <DeleteAiAssistantModal {...props} /> : <></>;
};
