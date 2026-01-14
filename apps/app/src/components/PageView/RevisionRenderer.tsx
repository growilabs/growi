import React, { type JSX } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import { ErrorBoundary } from 'react-error-boundary';
import ReactMarkdown from 'react-markdown';

import type { RendererOptions } from '~/interfaces/renderer-options';
import loggerFactory from '~/utils/logger';

import 'katex/dist/katex.min.css';

const logger = loggerFactory('components:Page:RevisionRenderer');

type Props = {
  rendererOptions: RendererOptions;
  markdown: string;
  additionalClassName?: string;
};

const ErrorFallback: React.FC<FallbackProps> = React.memo(
  ({ error, resetErrorBoundary }) => {
    return (
      <div role="alert">
        <p>Something went wrong:</p>
        <pre>{error.message}</pre>
        <button
          type="button"
          className="btn btn-primary"
          onClick={resetErrorBoundary}
        >
          Reload
        </button>
      </div>
    );
  },
);
ErrorFallback.displayName = 'ErrorFallback';

const RevisionRenderer = React.memo((props: Props): JSX.Element => {
  const { rendererOptions, markdown, additionalClassName } = props;

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ReactMarkdown
        {...rendererOptions}
        className={`wiki ${additionalClassName ?? ''}`}
      >
        {markdown}
      </ReactMarkdown>
    </ErrorBoundary>
  );
});
RevisionRenderer.displayName = 'RevisionRenderer';

export default RevisionRenderer;
