import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BacklinkListItem } from './BacklinkListItem';

describe('BacklinkListItem', () => {
  it('renders the page title and path as a link to the page', () => {
    // Arrange
    const backlink = { pageId: 'page-1', path: '/parent/child' };

    // Act
    render(<BacklinkListItem backlink={backlink} />);

    // Assert: title (latter segment) and the former path are both shown
    expect(screen.getByText('child')).toBeInTheDocument();
    expect(screen.getByText('/parent/', { exact: false })).toBeInTheDocument();

    // Assert: the row links to the target page by id
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/page-1');
  });
});
