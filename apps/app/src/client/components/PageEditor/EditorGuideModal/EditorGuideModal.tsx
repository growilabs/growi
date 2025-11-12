import type { JSX } from 'react';

import { useEditorGuideModalStatus, useEditorGuideModalActions } from '@growi/editor/dist/states/modal/editor-guide';

export const EditorGuideModal = (): JSX.Element => {
  const { isOpened } = useEditorGuideModalStatus();
  const { close } = useEditorGuideModalActions();

  if (!isOpened) {
    return <></>;
  }

  return (
    <>
      {/* Editor Guide Modal Overlay */}
      <div
        className="position-absolute w-100 h-100 modal-backdrop fade show z-2"
        onClick={close}
      />

      {/* Editor Guide Modal */}
      <div
        className="position-fixed top-0 bottom-0 start-50 end-0 d-flex align-items-center justify-content-center z-3 pe-none"
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
