import type { JSX } from 'react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export const EditorGuideModal = (props: Props): JSX.Element => {
  const { isOpen, onClose } = props;

  if (!isOpen) {
    return <></>;
  }

  return (
    <>
      {/* Editor Guide Modal Overlay */}
      <div
        className="position-absolute top-0 start-0 w-100 h-100 bg-dark opacity-50"
        style={{
          zIndex: 1040,
        }}
        onClick={onClose}
      />

      {/* Editor Guide Modal */}
      <div
        className="position-fixed top-0 bottom-0 start-50 end-0 d-flex align-items-center justify-content-center"
        style={{
          zIndex: 1050,
          pointerEvents: 'none',
        }}
      >
        <div className="px-3" style={{ pointerEvents: 'auto' }}>
          <div className="card shadow-lg">
            <div className="card-header d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Editor Guide</h5>
              <button
                type="button"
                className="btn-close"
                onClick={onClose}
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
