import { render, screen } from '@testing-library/react';
import type { SWRResponse } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IBacklink } from '../../interfaces/backlink';
import { useSWRxBacklinks } from '../stores/use-swrx-backlinks';
import { BacklinksPanel } from './BacklinksPanel';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/states/page', () => ({
  useCurrentPageId: () => 'page-1',
}));
vi.mock('../stores/use-swrx-backlinks', () => ({
  useSWRxBacklinks: vi.fn(),
}));

const mockBacklinks = (
  overrides: Partial<SWRResponse<IBacklink[], Error>>,
): void => {
  vi.mocked(useSWRxBacklinks).mockReturnValue(
    overrides as SWRResponse<IBacklink[], Error>,
  );
};

describe('BacklinksPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists an item per incoming backlink', () => {
    // Arrange
    mockBacklinks({
      data: [
        { pageId: 'p-a', path: '/foo' },
        { pageId: 'p-b', path: '/bar' },
      ],
      isLoading: false,
    });

    // Act
    render(<BacklinksPanel />);

    // Assert
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('foo')).toBeInTheDocument();
    expect(screen.getByText('bar')).toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-empty')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no backlinks', () => {
    // Arrange
    mockBacklinks({ data: [], isLoading: false });

    // Act
    render(<BacklinksPanel />);

    // Assert
    expect(screen.getByTestId('backlinks-empty')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows a loading state while data is undefined', () => {
    // Arrange
    mockBacklinks({ data: undefined, isLoading: true });

    // Act
    render(<BacklinksPanel />);

    // Assert: the loading indicator is shown, and neither the list nor the
    // empty state has appeared yet
    expect(screen.getByTestId('backlinks-loading')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-empty')).not.toBeInTheDocument();
  });
});
