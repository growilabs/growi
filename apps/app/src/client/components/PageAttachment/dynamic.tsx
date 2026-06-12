import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { useDeleteAttachmentModalStatus } from '~/states/ui/modal/delete-attachment.js';

type DeleteAttachmentModalProps = Record<string, unknown>;

export const DeleteAttachmentModalLazyLoaded = (): JSX.Element => {
  const status = useDeleteAttachmentModalStatus();

  const DeleteAttachmentModal = useLazyLoader<DeleteAttachmentModalProps>(
    'delete-attachment-modal',
    () =>
      import('./DeleteAttachmentModal.js').then((mod) => ({
        default: mod.DeleteAttachmentModal,
      })),
    status?.isOpened ?? false,
  );

  return DeleteAttachmentModal ? <DeleteAttachmentModal /> : <></>;
};
