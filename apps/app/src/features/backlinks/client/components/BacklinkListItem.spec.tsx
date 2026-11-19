import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BacklinkListItem } from './BacklinkListItem';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('BacklinkListItem', () => {
  it('renders the page title and path as a link to the page', () => {
    // Arrange
    const backlink = { pageId: 'page-1', path: '/parent/child' };

    // Act
    render(<BacklinkListItem {...backlink} />);

    // Assert: title (latter segment) and the former path are both shown
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.getByText('/parent/', { exact: false })).toBeInTheDocument();

    // Assert: the row links to the target page by id
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/page-1');
  });

  it('shows the trashed badge and keeps a trashed target linked', () => {
    // Act
    render(
      <BacklinkListItem
        pageId="page-1"
        path="/trash/parent/child"
        targetState="trashed"
      />,
    );

    // Assert
    expect(
      screen.getByText('backlinks.target_state.trashed'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/page-1');
  });

  it('shows the broken badge and renders a broken target path unlinked', () => {
    // Act
    render(
      <BacklinkListItem
        pageId={null}
        path="/parent/gone"
        targetState="broken"
      />,
    );

    // Assert: the path is still shown, but there is no page to link to
    expect(
      screen.getByText('backlinks.target_state.broken'),
    ).toBeInTheDocument();
    expect(screen.getByText('gone')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // undefined is how the incoming backlinks list renders its rows
  it.each([
    { targetState: 'normal' as const },
    { targetState: undefined },
  ])('renders only the linked path when targetState is $targetState', ({
    targetState,
  }) => {
    // Act
    render(
      <BacklinkListItem
        pageId="page-1"
        path="/parent/child"
        targetState={targetState}
      />,
    );

    // Assert: the row holds nothing but the path, so no badge of any kind
    expect(screen.getByRole('listitem')).toHaveTextContent(/^\/parent\/child$/);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/page-1');
  });
});
