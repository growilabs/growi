import type { JSX, RefObject } from 'react';
import { useEditorGuideModalStatus } from '@growi/editor/dist/states/modal/editor-guide';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';

type Props = {
  containerRef: RefObject<HTMLDivElement | null>;
};

export const EditorGuideModalLazyLoaded = ({
  containerRef,
}: Props): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();

  const EditorGuideModal = useLazyLoader(
    'editor-guide-modal',
    () =>
      import('./EditorGuideModal.js').then((mod) => ({
        default: mod.EditorGuideModal,
      })),
    isOpened,
  );

  return EditorGuideModal != null ? (
    <EditorGuideModal containerRef={containerRef} />
  ) : (
    <></>
  );
};
