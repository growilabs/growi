// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import { IncompleteResponseNotice } from './IncompleteResponseNotice';

// `t` returns the i18n key verbatim, so each test asserts the component selected
// the correct `ai_sidebar.incomplete.*` key for the given finish reason — without
// coupling to the translation text (which lives in the locale JSON, not here).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('IncompleteResponseNotice', () => {
  it.each([
    ['length', 'ai_sidebar.incomplete.length'],
    ['tool-calls', 'ai_sidebar.incomplete.tool_calls'],
    ['content-filter', 'ai_sidebar.incomplete.content_filter'],
    ['error', 'ai_sidebar.incomplete.error'],
    ['other', 'ai_sidebar.incomplete.unknown'],
  ])('shows the reason-specific notice for finishReason=%s', (finishReason, expectedKey) => {
    render(<IncompleteResponseNotice finishReason={finishReason} />);

    expect(screen.getByRole('status').textContent).toContain(expectedKey);
  });

  it.each([
    ['stop'],
    [undefined],
  ])('renders nothing for finishReason=%s (normal or not-yet-finished)', (finishReason) => {
    const { container } = render(
      <IncompleteResponseNotice finishReason={finishReason} />,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
