import type { JSX } from 'react';

import { useEmptyTrashModalStatus } from '~/states/ui/modal/empty-trash';

import { useLazyLoader } from '../../util/use-lazy-loader';

type EmptyTrashModalProps = Record<string, unknown>;

export const EmptyTrashModalLazyLoaded = (): JSX.Element => {
  const status = useEmptyTrashModalStatus();

  const EmptyTrashModal = useLazyLoader<EmptyTrashModalProps>(
    'empty-trash-modal',
    () => import('./EmptyTrashModal').then(mod => ({ default: mod.EmptyTrashModal })),
    status?.isOpened ?? false,
  );

  return EmptyTrashModal != null ? <EmptyTrashModal /> : <></>;
};
