import {
  useState, useEffect, useLayoutEffect, type JSX, type RefObject,
} from 'react';

import { useEditorGuideModalStatus, useEditorGuideModalActions } from '@growi/editor/dist/states/modal/editor-guide';
import { createPortal } from 'react-dom';

type Props = {
  containerRef: RefObject<HTMLDivElement | null>,
};

/**
 * EditorGuideModal
 *
 * This modal overlays only the preview area (specified by containerRef),
 * not the entire screen. Uses createPortal to render into document.body.
 */
export const EditorGuideModal = ({ containerRef }: Props): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();
  const [isShown, setIsShown] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Get rect on open and on resize
  useLayoutEffect(() => {
    if (!isOpened || containerRef.current == null) return;

    const updateRect = () => setRect(containerRef.current?.getBoundingClientRect() ?? null);
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [isOpened, containerRef]);

  // Trigger fade-in after mount
  useEffect(() => {
    if (!isOpened) {
      setIsShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setIsShown(true));
    return () => cancelAnimationFrame(id);
  }, [isOpened]);

  if (!isOpened || rect == null) return <></>;

  const style = {
    position: 'fixed' as const, top: rect.top, left: rect.left, width: rect.width, height: rect.height,
  };

  return createPortal(
    <>
      <div className={`modal-backdrop fade z-2 ${isShown ? 'show' : ''}`} style={style} onClick={close} aria-hidden="true" />
      <div className={`d-flex align-items-center justify-content-center z-3 pe-none fade ${isShown ? 'show' : ''}`} style={style}>
        <div className="px-3 pe-auto">
          <div className="card shadow-lg">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Editor Guide</h5>
              <button type="button" className="btn-close" onClick={close} aria-label="Close" />
            </div>
            <div className="card-body overflow-auto">
              <p>This is a test modal.</p>
              <p>It appears in the center of the preview area on the right side.</p>
              <p>The background is darkened to emphasize the modal.</p>
              <p className="mb-0">Click the close button or the background to close.</p>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};
