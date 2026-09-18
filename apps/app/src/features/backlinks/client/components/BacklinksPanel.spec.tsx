import { ErrorV3 } from '@growi/core/dist/models';
import { render, screen } from '@testing-library/react';
import type { SWRResponse } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IErrorV3 } from '~/interfaces/errors/v3-error';
import { useCurrentPageId } from '~/states/page';

import type { IBacklink } from '../../interfaces/backlink';
import { useSWRxBacklinks } from '../stores/backlinks';
import { BacklinksPanel } from './BacklinksPanel';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/states/page', () => ({
  useCurrentPageId: vi.fn(),
}));
vi.mock('../stores/backlinks', () => ({
  useSWRxBacklinks: vi.fn(),
}));

// WHY the assertion instead of mock<SWRResponse<...>>(): the panel branches on
// `error` / `data` being nullish, and mock<T>() auto-stubs every unspecified
// member with a (truthy) mock function -- an unset `error` would then look like a
// real error. Only the plain object keeps "not provided" == undefined.
const mockBacklinks = (
  overrides: Partial<SWRResponse<IBacklink[], IErrorV3[]>>,
): void => {
  vi.mocked(useSWRxBacklinks).mockReturnValue(
    overrides as SWRResponse<IBacklink[], IErrorV3[]>,
  );
};

describe('BacklinksPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCurrentPageId).mockReturnValue('page-1');
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

  it('shows an error message instead of spinning forever when the fetch fails', () => {
    // Arrange: SWR reports a failed fetch as error set + data still undefined
    mockBacklinks({
      data: undefined,
      error: [new ErrorV3('failed to fetch backlinks')],
      isLoading: false,
    });

    // Act
    render(<BacklinksPanel />);

    // Assert: the failure is surfaced, and the panel is not stuck on loading
    expect(screen.getByTestId('backlinks-error')).toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-empty')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows the empty state, not a spinner, when there is no current page id', () => {
    // Arrange: an empty / not-found page has no page id, so the hook never
    // fetches and stays at data undefined with isLoading false
    vi.mocked(useCurrentPageId).mockReturnValue(undefined);
    mockBacklinks({ data: undefined, isLoading: false });

    // Act
    render(<BacklinksPanel />);

    // Assert
    expect(screen.getByTestId('backlinks-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-loading')).not.toBeInTheDocument();
  });
});
