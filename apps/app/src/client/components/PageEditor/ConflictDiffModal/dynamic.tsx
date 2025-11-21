import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useConflictDiffModalStatus } from '~/states/ui/modal/conflict-diff';

type ConflictDiffModalProps = Record<string, unknown>;

export const ConflictDiffModalLazyLoaded = (): JSX.Element => {
  const status = useConflictDiffModalStatus();

  const ConflictDiffModal = useLazyLoader<ConflictDiffModalProps>(
    'conflict-diff-modal',
    () => import('./ConflictDiffModal').then(mod => ({ default: mod.ConflictDiffModal })),
    status?.isOpened ?? false,
  );

  return ConflictDiffModal ? <ConflictDiffModal /> : <></>;
};
