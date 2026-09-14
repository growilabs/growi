import type { NextRouter } from 'next/router';
import { useRouter } from 'next/router';
import { fireEvent, render } from '@testing-library/react';
import type { Element } from 'hast';
import { mock } from 'vitest-mock-extended';

import { useStartEditing } from '~/client/services/use-start-editing';
import {
  useCurrentPageYjsData,
  useCurrentPageYjsDataLoading,
} from '~/features/collaborative-editor/states';
import {
  useIsGuestUser,
  useIsReadOnlyUser,
  useIsSharedUser,
} from '~/states/context';
import { useCurrentPagePath } from '~/states/page';
import { useShareLinkId } from '~/states/page/hooks';

import { EditLink, Header } from './Header';

// Mock every hook Header/EditLink depend on so they render in isolation.
vi.mock('next/router', () => ({
  useRouter: vi.fn(),
}));
vi.mock('~/client/services/use-start-editing');
vi.mock('~/features/collaborative-editor/states');
vi.mock('~/states/context');
vi.mock('~/states/page');
vi.mock('~/states/page/hooks');

const mockNode = (tagName: string): Element =>
  mock<Element>({
    tagName,
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    },
  });

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue(
    mock<NextRouter>({
      events: { on: vi.fn(), off: vi.fn() },
    }),
  );
  vi.mocked(useStartEditing).mockReturnValue(vi.fn());
  vi.mocked(useCurrentPageYjsData).mockReturnValue(undefined);
  vi.mocked(useCurrentPageYjsDataLoading).mockReturnValue(false);
  vi.mocked(useIsGuestUser).mockReturnValue(false);
  vi.mocked(useIsReadOnlyUser).mockReturnValue(false);
  vi.mocked(useIsSharedUser).mockReturnValue(false);
  vi.mocked(useCurrentPagePath).mockReturnValue('/test');
  vi.mocked(useShareLinkId).mockReturnValue(undefined);
});

describe('Header', () => {
  it('applies the user-specified inline style from the original HTML heading', () => {
    const { container } = render(
      <Header node={mockNode('h2')} id="menu" style={{ color: '#ff0000' }}>
        menu
      </Header>,
    );

    const heading = container.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading?.style.color).toBe('#ff0000');
  });

  it("merges the user-specified class with GROWI's own heading class", () => {
    const { container } = render(
      <Header
        node={mockNode('h2')}
        id="menu"
        className="h6 font-weight-bold mb-3"
      >
        menu
      </Header>,
    );

    const heading = container.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading?.classList.contains('position-relative')).toBe(true);
    expect(heading?.classList.contains('h6')).toBe(true);
    expect(heading?.classList.contains('font-weight-bold')).toBe(true);
    expect(heading?.classList.contains('mb-3')).toBe(true);
  });
});

describe('EditLink', () => {
  it('marks the icon as decorative so screen readers do not read it out', () => {
    const { container } = render(<EditLink line={1} />);

    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveTextContent('edit_square');
  });

  it('keeps the button enabled and wired to startEditing when a line is provided', () => {
    const startEditing = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useStartEditing).mockReturnValue(startEditing);
    vi.mocked(useCurrentPagePath).mockReturnValue('/test/page');

    const { container } = render(<EditLink line={5} />);

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button).not.toBeDisabled();

    fireEvent.click(button as HTMLButtonElement);
    expect(startEditing).toHaveBeenCalledWith('/test/page');
  });

  it('disables the button when no line is provided', () => {
    const { container } = render(<EditLink />);

    const button = container.querySelector('button');
    expect(button).toBeDisabled();
  });
});
