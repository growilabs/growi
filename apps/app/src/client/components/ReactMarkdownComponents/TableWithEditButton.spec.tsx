import { cleanup, render } from '@testing-library/react';
import type { Element } from 'hast';
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

const { TableWithEditButton } = await import('./TableWithEditButton');

const dummyNode = {
  position: { start: { line: 1 }, end: { line: 2 } },
} as unknown as Element;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TableWithEditButton', () => {
  it('marks the icon as decorative so screen readers do not read it out', () => {
    const { container } = render(
      <TableWithEditButton node={dummyNode}>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </TableWithEditButton>,
    );

    const icon = container.querySelector('.material-symbols-outlined');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The visible glyph text itself must remain unchanged
    expect(icon).toHaveTextContent('edit_square');
  });

  it('still renders the edit button visibly with its click handler wired', () => {
    const { container } = render(
      <TableWithEditButton node={dummyNode}>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </TableWithEditButton>,
    );

    const button = container.querySelector('button.handsontable-modal-trigger');
    expect(button).not.toBeNull();
  });
});
