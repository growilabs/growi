import React, { type JSX } from 'react';

type Props = {
  isEnabled: boolean;
  isProcessing: boolean;
  buttonLabel: string;
  description: string;
  onNormalizingRequested: () => void;
};

const NormalizeIndicesControls = (props: Props): JSX.Element => {
  const {
    isEnabled,
    isProcessing,
    buttonLabel,
    description,
    onNormalizingRequested,
  } = props;

  return (
    <>
      <button
        type="button"
        className={`btn ${isEnabled ? 'btn-outline-info' : 'btn-outline-secondary'}`}
        onClick={onNormalizingRequested}
        disabled={!isEnabled}
      >
        {isProcessing && (
          <span
            className="spinner-border spinner-border-sm me-2"
            role="status"
            aria-hidden="true"
          />
        )}
        {buttonLabel}
      </button>

      <p className="form-text text-muted">
        {description}
        <br />
      </p>
    </>
  );
};

export default NormalizeIndicesControls;
