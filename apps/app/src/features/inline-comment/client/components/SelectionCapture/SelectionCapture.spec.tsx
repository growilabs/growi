import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SelectionCapture } from './SelectionCapture';

type CapturedSelectionFixture = {
  quote: string;
  prefix: string;
  suffix: string;
  approxOffset: number;
};

const textSelectionStore = vi.hoisted(() => ({
  captured: null as CapturedSelectionFixture | null,
}));

vi.mock('./use-text-selection', () => ({
  useTextSelection: () => textSelectionStore.captured,
}));

vi.mock('../InlineCommentForm/InlineCommentForm', () => ({
  InlineCommentForm: ({ anchor }: { anchor: CapturedSelectionFixture }) => (
    <div data-testid="inline-comment-form">{anchor.quote}</div>
  ),
}));

describe('SelectionCapture', () => {
  afterEach(() => {
    textSelectionStore.captured = null;
  });

  it('does not show the form when there is no captured selection (Requirement 1.7)', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(
      <SelectionCapture
        containerRef={containerRef}
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
      />,
    );

    expect(screen.queryByTestId('inline-comment-form')).not.toBeInTheDocument();
  });

  it('shows InlineCommentForm with the captured anchor once a selection exists', () => {
    textSelectionStore.captured = {
      quote: 'hello world',
      prefix: 'pre',
      suffix: 'suf',
      approxOffset: 10,
    };
    const containerRef = createRef<HTMLDivElement>();
    render(
      <SelectionCapture
        containerRef={containerRef}
        pageId="page-1"
        anchorOriginRevisionId="rev-1"
      />,
    );

    expect(screen.getByTestId('inline-comment-form')).toHaveTextContent(
      'hello world',
    );
  });
});
