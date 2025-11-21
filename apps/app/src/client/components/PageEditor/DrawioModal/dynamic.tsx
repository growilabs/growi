import type { JSX } from 'react';

import { useDrawioModalForEditorStatus } from '@growi/editor/dist/states/modal/drawio-for-editor';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useDrawioModalStatus } from '~/states/ui/modal/drawio';


type DrawioModalProps = Record<string, unknown>;

export const DrawioModalLazyLoaded = (): JSX.Element => {
  const status = useDrawioModalStatus();
  const statusForEditor = useDrawioModalForEditorStatus();

  const isOpened = status?.isOpened ?? false;
  const isOpenedInEditor = statusForEditor?.isOpened ?? false;

  const DrawioModal = useLazyLoader<DrawioModalProps>(
    'drawio-modal',
    () => import('./DrawioModal').then(mod => ({ default: mod.DrawioModal })),
    isOpened || isOpenedInEditor,
  );

  return DrawioModal ? <DrawioModal /> : <></>;
};
