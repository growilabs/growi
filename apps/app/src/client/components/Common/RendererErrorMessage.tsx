import React from 'react';

export const RendererErrorMessage: React.FC = () => {
  return (
    <p className="alert alert-warning">
      ⚠️ <strong>Developer Warning:</strong>{' '}
      Required renderer configuration is missing. Ensure <code>useRendererConfig()</code> is properly called in the component.
    </p>
  );
};
