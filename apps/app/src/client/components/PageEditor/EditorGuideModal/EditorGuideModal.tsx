import { useState, useEffect, type JSX } from 'react';

import { useEditorGuideModalStatus, useEditorGuideModalActions } from '@growi/editor/dist/states/modal/editor-guide';

/**
 * EditorGuideModalSubstance - The actual modal content
 * Only rendered when isOpened is true
 */
const EditorGuideModalSubstance = ({ close }: { close: () => void }): JSX.Element => {
  const [isShown, setIsShown] = useState(false);

  // Trigger fade-in after mount
  useEffect(() => {
    // Use requestAnimationFrame to ensure the DOM has been painted before adding 'show' class
    const frameId = requestAnimationFrame(() => {
      setIsShown(true);
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <>
      {/* Editor Guide Modal Overlay - covers only the preview area */}
      <div
        className={`position-absolute w-100 h-100 modal-backdrop fade z-2 ${isShown ? 'show' : ''}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Editor Guide Modal Content */}
      <div
        className={`position-fixed top-0 bottom-0 start-50 end-0 d-flex align-items-center justify-content-center z-3 pe-none fade ${isShown ? 'show' : ''}`}
      >
        <div className="px-3">
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
    </>
  );
};

/**
 * EditorGuideModal (Container)
 *
 * This modal is rendered within the Preview component and overlays only the preview area,
 * not the entire screen. The backdrop covers the preview area only.
 *
 * The container div is always rendered (for fade transitions),
 * but the actual content (Substance) is only rendered when isOpened is true.
 */
export const EditorGuideModal = (): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();

  return (
    <div className={`${isOpened ? 'show' : ''}`}>
      {isOpened && <EditorGuideModalSubstance close={close} />}
    </div>
  );
};
