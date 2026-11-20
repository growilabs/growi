// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import type { ChangeProposalView, OperationView } from '../../../../interfaces';
import { RemainingOperationsList } from './RemainingOperationsList';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const createOperation = (
  overrides: Partial<OperationView> = {},
): OperationView => ({
  key: 'op-1',
  type: 'edit',
  status: 'applied',
  ...overrides,
});

const createView = (
  operations: OperationView[],
  isRequester = true,
): Pick<ChangeProposalView, 'isRequester' | 'operations'> => ({
  isRequester,
  operations,
});

describe('RemainingOperationsList', () => {
  it('lists path and status of operations that were not applied', () => {
    render(
      <RemainingOperationsList
        view={createView([
          createOperation({ key: 'a', status: 'applied', path: '/applied' }),
          createOperation({ key: 'b', status: 'failed', path: '/failed' }),
          createOperation({ key: 'c', status: 'stale', path: '/stale' }),
        ])}
      />,
    );

    expect(
      screen.getByText('change_proposal_viewer.remaining_operations.title'),
    ).toBeTruthy();
    expect(screen.getByText('/failed')).toBeTruthy();
    expect(screen.getByText('/stale')).toBeTruthy();
    expect(screen.queryByText('/applied')).toBeNull();
    expect(
      screen.getByText('change_proposal.operation_status.failed'),
    ).toBeTruthy();
  });

  it('shows stale with the skipped wording and without an error style', () => {
    const { container } = render(
      <RemainingOperationsList
        view={createView([
          createOperation({ status: 'stale', path: '/stale' }),
        ])}
      />,
    );

    const word = screen.getByText('change_proposal.operation_status.stale');
    expect(word.className).not.toMatch(/danger|error|warning/);
    expect(container.querySelector('.text-danger, .alert-danger')).toBeNull();
  });

  it('does not list operations the requester skipped on purpose', () => {
    render(
      <RemainingOperationsList
        view={createView([
          createOperation({
            status: 'skipped',
            reason: 'skipped-by-requester',
            path: '/skipped',
          }),
        ])}
      />,
    );
    expect(screen.queryByText('/skipped')).toBeNull();
  });

  it('renders for the requester regardless of the entry type', () => {
    render(
      <RemainingOperationsList
        view={createView([createOperation({ status: 'failed', path: '/x' })])}
      />,
    );
    expect(screen.getByText('/x')).toBeTruthy();
  });

  it('shows nothing when no operation remains', () => {
    const { container } = render(
      <RemainingOperationsList view={createView([createOperation()])} />,
    );
    expect(container.textContent).toBe('');
  });

  it('shows nothing for a non-requester', () => {
    const { container } = render(
      <RemainingOperationsList
        view={createView(
          [createOperation({ status: 'failed', path: '/x' })],
          false,
        )}
      />,
    );
    expect(container.textContent).toBe('');
  });
});
