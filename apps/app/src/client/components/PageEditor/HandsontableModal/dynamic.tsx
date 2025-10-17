import type { JSX } from 'react';

import { useHandsontableModalForEditorStatus } from '@growi/editor';

import { useLazyLoader } from '~/client/util/use-lazy-loader';
import { useHandsontableModalStatus } from '~/states/ui/modal/handsontable';

type HandsontableModalProps = Record<string, unknown>;

export const HandsontableModalLazyLoaded = (): JSX.Element => {
  const status = useHandsontableModalStatus();
  const statusForEditor = useHandsontableModalForEditorStatus();

  const HandsontableModal = useLazyLoader<HandsontableModalProps>(
    'handsontable-modal',
    () => import('./HandsontableModal').then(mod => ({ default: mod.HandsontableModal })),
    status?.isOpened || statusForEditor?.isOpened || false,
  );

  return HandsontableModal ? <HandsontableModal /> : <></>;
};
