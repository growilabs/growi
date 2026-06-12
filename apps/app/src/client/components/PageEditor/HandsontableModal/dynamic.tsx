import type { JSX } from 'react';
import { useHandsontableModalForEditorStatus } from '@growi/editor';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';
import { useHandsontableModalStatus } from '~/states/ui/modal/handsontable.js';

type HandsontableModalProps = Record<string, unknown>;

export const HandsontableModalLazyLoaded = (): JSX.Element => {
  const status = useHandsontableModalStatus();
  const statusForEditor = useHandsontableModalForEditorStatus();

  const HandsontableModal = useLazyLoader<HandsontableModalProps>(
    'handsontable-modal',
    () =>
      import('./HandsontableModal.js').then((mod) => ({
        default: mod.HandsontableModal,
      })),
    status?.isOpened || statusForEditor?.isOpened || false,
  );

  return HandsontableModal ? <HandsontableModal /> : <></>;
};
