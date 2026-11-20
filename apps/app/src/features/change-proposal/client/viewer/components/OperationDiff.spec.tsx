// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';

import type { OperationView } from '../../../interfaces';
import { OperationDiff } from './OperationDiff';

const mocks = vi.hoisted(() => ({ useSWRxOperationDiff: vi.fn() }));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../stores/use-swrx-operation-diff', () => ({
  useSWRxOperationDiff: mocks.useSWRxOperationDiff,
}));

vi.mock('./UnifiedDiffView', () => ({
  UnifiedDiffView: ({ unifiedDiff }: { unifiedDiff: string }) => (
    <pre data-testid="unified-diff">{unifiedDiff}</pre>
  ),
}));

const operation: OperationView = {
  key: 'op-1',
  type: 'edit',
  status: 'applied',
  page: { id: 'page-1', path: '/p' },
  baseRevisionId: 'rev-a',
  resultRevisionId: 'rev-b',
};

describe('OperationDiff', () => {
  beforeEach(() => {
    mocks.useSWRxOperationDiff.mockReset();
    mocks.useSWRxOperationDiff.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
  });

  it('is closed at first and asks the hook not to fetch', () => {
    render(<OperationDiff operation={operation} />);

    expect(mocks.useSWRxOperationDiff).toHaveBeenLastCalledWith(
      operation,
      false,
    );
    expect(
      screen.getByText('change_proposal_viewer.operation.show_diff'),
    ).toBeTruthy();
    expect(screen.queryByTestId('unified-diff')).toBeNull();
  });

  it('opens, fetches, shows the diff and closes again', () => {
    mocks.useSWRxOperationDiff.mockReturnValue({
      data: { type: 'diff', unifiedDiff: 'DIFF-BODY' },
      isLoading: false,
    });
    render(<OperationDiff operation={operation} />);

    fireEvent.click(
      screen.getByText('change_proposal_viewer.operation.show_diff'),
    );

    expect(mocks.useSWRxOperationDiff).toHaveBeenLastCalledWith(
      operation,
      true,
    );
    expect(screen.getByTestId('unified-diff').textContent).toBe('DIFF-BODY');

    fireEvent.click(
      screen.getByText('change_proposal_viewer.operation.hide_diff'),
    );
    expect(screen.queryByTestId('unified-diff')).toBeNull();
  });

  it('shows the loading text while the diff is being fetched', () => {
    mocks.useSWRxOperationDiff.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    render(<OperationDiff operation={operation} />);
    fireEvent.click(
      screen.getByText('change_proposal_viewer.operation.show_diff'),
    );

    expect(
      screen.getByText('change_proposal_viewer.operation.diff_loading'),
    ).toBeTruthy();
  });

  it('shows the unavailable text when the diff cannot be shown', () => {
    mocks.useSWRxOperationDiff.mockReturnValue({
      data: { type: 'unavailable' },
      isLoading: false,
    });
    render(<OperationDiff operation={operation} />);
    fireEvent.click(
      screen.getByText('change_proposal_viewer.operation.show_diff'),
    );

    expect(
      screen.getByText('change_proposal_viewer.operation.diff_unavailable'),
    ).toBeTruthy();
    expect(screen.queryByTestId('unified-diff')).toBeNull();
  });
});
