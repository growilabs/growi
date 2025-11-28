import {
  useState, useEffect, type JSX, type CSSProperties,
} from 'react';

import { useEditorGuideModalStatus, useEditorGuideModalActions } from '@growi/editor/dist/states/modal/editor-guide';
import { createPortal } from 'react-dom';

type SubstanceProps = {
  rect: DOMRectReadOnly,
  close: () => void,
};

/**
 * EditorGuideModalSubstance - The actual modal content
 * Renders backdrop and modal content over the specified area
 * Uses position:fixed to prevent scrolling with the container
 */
const EditorGuideModalSubstance = ({ rect, close }: SubstanceProps): JSX.Element => {
  const [isShown, setIsShown] = useState(false);

  // Trigger fade-in after mount
  useEffect(() => {
    // Use requestAnimationFrame to ensure the DOM has been painted before adding 'show' class
    const frameId = requestAnimationFrame(() => {
      setIsShown(true);
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Fixed positioning style based on container's viewport position
  const fixedStyle: CSSProperties = {
    position: 'fixed',
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };

  return createPortal(
    <>
      {/* Editor Guide Modal Overlay - covers only the preview area */}
      <div
        className={`modal-backdrop fade z-2 ${isShown ? 'show' : ''}`}
        style={fixedStyle}
        onClick={close}
        aria-hidden="true"
      />

      {/* Editor Guide Modal Content */}
      <div
        className={`d-flex align-items-center justify-content-center z-3 pe-none fade ${isShown ? 'show' : ''}`}
        style={fixedStyle}
      >
        <div className="px-3 pe-auto">
          <div className="card shadow-lg">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Editor Guide</h5>
              <button
                type="button"
                className="btn-close"
                onClick={close}
                aria-label="Close"
              />
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

type Props = {
  rect: DOMRectReadOnly,
};

/**
 * EditorGuideModal (Container)
 *
 * This modal overlays only the preview area (specified by rect),
 * not the entire screen. Uses createPortal to render into document.body.
 */
export const EditorGuideModal = ({ rect }: Props): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();

  if (!isOpened) {
    return <></>;
  }

  return <EditorGuideModalSubstance rect={rect} close={close} />;
};
