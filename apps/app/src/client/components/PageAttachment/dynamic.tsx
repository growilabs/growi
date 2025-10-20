import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useDeleteAttachmentModalStatus } from '~/states/ui/modal/delete-attachment';

type DeleteAttachmentModalProps = Record<string, unknown>;

export const DeleteAttachmentModalLazyLoaded = (): JSX.Element => {
  const status = useDeleteAttachmentModalStatus();

  const DeleteAttachmentModal = useLazyLoader<DeleteAttachmentModalProps>(
    'delete-attachment-modal',
    () => import('./DeleteAttachmentModal').then(mod => ({ default: mod.DeleteAttachmentModal })),
    status?.isOpened ?? false,
  );

  return DeleteAttachmentModal ? <DeleteAttachmentModal /> : <></>;
};
