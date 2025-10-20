import type { JSX } from 'react';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useShortcutsModalStatus } from '~/states/ui/modal/shortcuts';

type ShortcutsModalProps = Record<string, unknown>;

export const ShortcutsModalLazyLoaded = (): JSX.Element => {
  const status = useShortcutsModalStatus();

  const ShortcutsModal = useLazyLoader<ShortcutsModalProps>(
    'shortcuts-modal',
    () => import('./ShortcutsModal').then(mod => ({ default: mod.ShortcutsModal })),
    status?.isOpened ?? false,
  );

  // ShortcutsModal handles early return and fadeout transition internally
  return ShortcutsModal ? <ShortcutsModal /> : <></>;
};
