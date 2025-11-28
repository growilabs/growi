import type { JSX } from 'react';

import { useEditorGuideModalStatus } from '@growi/editor/dist/states/modal/editor-guide';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';

type Props = {
  rect: DOMRectReadOnly | undefined,
};

export const EditorGuideModalLazyLoaded = ({ rect }: Props): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();

  const EditorGuideModal = useLazyLoader(
    'editor-guide-modal',
    () => import('./EditorGuideModal').then(mod => ({ default: mod.EditorGuideModal })),
    isOpened,
  );

  return (EditorGuideModal != null && rect != null)
    ? <EditorGuideModal rect={rect} />
    : <></>;
};
