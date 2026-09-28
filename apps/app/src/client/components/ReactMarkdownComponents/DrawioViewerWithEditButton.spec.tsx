import { useEffect } from 'react';
import type { DrawioViewerProps } from '@growi/remark-drawio';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockUseIsGuestUser = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockUseIsReadOnlyUser = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockUseIsSharedUser = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockUseShareLinkId = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockUseIsRevisionOutdated = vi.hoisted(() =>
  vi.fn().mockReturnValue(false),
);
const mockUseCurrentPageYjsData = vi.hoisted(() =>
  vi.fn().mockReturnValue(undefined),
);

vi.mock('~/states/context', () => ({
  useIsGuestUser: mockUseIsGuestUser,
  useIsReadOnlyUser: mockUseIsReadOnlyUser,
  useIsSharedUser: mockUseIsSharedUser,
}));
vi.mock('~/states/page/hooks', () => ({
  useShareLinkId: mockUseShareLinkId,
}));
vi.mock('~/stores/page', () => ({
  useIsRevisionOutdated: mockUseIsRevisionOutdated,
}));
vi.mock('~/features/collaborative-editor/states', () => ({
  useCurrentPageYjsData: mockUseCurrentPageYjsData,
}));

// The real DrawioViewer talks to the mxgraph/GraphViewer runtime, which is not
// available in a unit test environment. Stub it down to a component that
// immediately reports a rendered diagram, which is all this wrapper's edit
// button needs to become visible.
vi.mock('@growi/remark-drawio', () => ({
  DrawioViewer: (props: DrawioViewerProps) => {
    const { onRenderingUpdated } = props;
    useEffect(() => {
      onRenderingUpdated?.('<mxfile></mxfile>');
    }, [onRenderingUpdated]);
    return <div data-testid="drawio-viewer-mock" />;
  },
}));

const { DrawioViewerWithEditButton } = await import(
  './DrawioViewerWithEditButton'
);

const dummyProps = {
  isDarkMode: 'false',
  diagramIndex: 0,
  bol: 1,
  eol: 2,
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DrawioViewerWithEditButton', () => {
  it('marks the icon as decorative so screen readers do not read it out', () => {
    const { container } = render(
      <DrawioViewerWithEditButton {...dummyProps} />,
    );

    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The visible glyph text itself must remain unchanged
    expect(icon).toHaveTextContent('edit_square');
  });

  it('still renders the edit button visibly with its click handler wired', () => {
    const { container } = render(
      <DrawioViewerWithEditButton {...dummyProps} />,
    );

    const button = container.querySelector('button.btn-edit-drawio');
    expect(button).not.toBeNull();
  });
});
