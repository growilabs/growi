import type { JSX } from 'react';

import { useEmptyTrashModalStatus } from '~/states/ui/modal/empty-trash.js';

import { useLazyLoader } from '../../../components/utils/use-lazy-loader.js';

type EmptyTrashModalProps = Record<string, unknown>;

export const EmptyTrashModalLazyLoaded = (): JSX.Element => {
  const status = useEmptyTrashModalStatus();

  const EmptyTrashModal = useLazyLoader<EmptyTrashModalProps>(
    'empty-trash-modal',
    () =>
      import('./EmptyTrashModal.js').then((mod) => ({
        default: mod.EmptyTrashModal,
      })),
    status?.isOpened ?? false,
  );

  return EmptyTrashModal != null ? <EmptyTrashModal /> : <></>;
};
