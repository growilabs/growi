// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import type { ChangeProposalView, OperationView } from '../../../interfaces';
import {
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  OPERATION_TYPE_LABEL_KEYS,
  REVERT_REFUSAL_REASON_LABEL_KEYS,
} from '../../shared';
import { OperationItem } from './OperationItem';
import type { OperationActionSlotProps } from './requester-action-slots';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mocks = vi.hoisted(() => {
  const slots: Record<string, unknown> = {};
  return { slots };
});

vi.mock('./requester-action-slots', () => ({
  REQUESTER_ACTION_SLOTS: mocks.slots,
}));

vi.mock('./OperationDiff', () => ({
  OperationDiff: ({ operation }: { operation: OperationView }) => (
    <button type="button" data-testid="diff-control">
      {operation.key}
    </button>
  ),
}));

const proposal: ChangeProposalView = {
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice' },
  entry: 'ai-chat',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'pending',
  isRequester: true,
  operations: [],
};

const createOperation = (
  overrides: Partial<OperationView> = {},
): OperationView => ({
  key: 'op-1',
  type: 'edit',
  status: 'applied',
  page: { id: 'page-1', path: '/current/path' },
  path: '/recorded/path',
  baseRevisionId: 'rev-base',
  resultRevisionId: 'rev-result',
  ...overrides,
});

const STATUSES: readonly OperationView['status'][] = [
  'pending',
  'applied',
  'failed',
  'stale',
  'skipped',
  'reverted',
  'revert-refused',
];

describe('OperationItem', () => {
  describe('kind, status and reason', () => {
    it.each(STATUSES)('shows the status words for %s', (status) => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ status })}
        />,
      );

      expect(
        screen.getByText(OPERATION_STATUS_LABEL_KEYS[status]),
      ).toBeTruthy();
    });

    it('shows the kind words', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ type: 'create' })}
        />,
      );

      expect(screen.getByText(OPERATION_TYPE_LABEL_KEYS.create)).toBeTruthy();
    });

    it('shows the reason words only when a reason is returned', () => {
      const { rerender } = render(
        <OperationItem proposal={proposal} operation={createOperation()} />,
      );
      expect(
        screen.queryByText(OPERATION_REASON_LABEL_KEYS['page-being-edited']),
      ).toBeNull();

      rerender(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            status: 'skipped',
            reason: 'page-being-edited',
          })}
        />,
      );
      expect(
        screen.getByText(OPERATION_REASON_LABEL_KEYS['page-being-edited']),
      ).toBeTruthy();
    });
  });

  describe('paths', () => {
    it('shows both paths of a move', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            type: 'move',
            fromPath: '/from/here',
            toPath: '/to/there',
            page: undefined,
            path: undefined,
          })}
        />,
      );

      expect(screen.getByText('/from/here')).toBeTruthy();
      expect(screen.getByText('/to/there')).toBeTruthy();
    });

    it('shows the current page path when the page exists', () => {
      render(
        <OperationItem proposal={proposal} operation={createOperation()} />,
      );

      expect(screen.getByText('/current/path')).toBeTruthy();
      expect(screen.queryByText('/recorded/path')).toBeNull();
    });

    it('shows path for a reverted create whose page is gone', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            type: 'create',
            status: 'reverted',
            page: undefined,
            path: '/created/path',
            revertedByProposalId: 'rp-1',
          })}
        />,
      );

      expect(screen.getByText('/created/path')).toBeTruthy();
      expect(
        screen.queryByText('change_proposal_viewer.operation.page_gone'),
      ).toBeNull();
    });

    it.each([
      'skipped',
      'failed',
      'pending',
    ] as const)('shows the current page path for a %s delete-completely whose page still exists', (status) => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            type: 'delete-completely',
            status,
            page: { id: 'page-9', path: '/still/here' },
            path: '/original/created/path',
          })}
        />,
      );

      expect(screen.getByText('/still/here')).toBeTruthy();
      expect(screen.queryByText('/original/created/path')).toBeNull();
    });

    it('shows path for an edit without page', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            page: undefined,
            path: '/recorded/at/apply',
          })}
        />,
      );

      expect(screen.getByText('/recorded/at/apply')).toBeTruthy();
    });

    it('shows the page-gone text only when neither page nor path exists', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ page: undefined, path: undefined })}
        />,
      );

      expect(
        screen.getByText('change_proposal_viewer.operation.page_gone'),
      ).toBeTruthy();
    });
  });

  describe('order number', () => {
    it('shows the order number to the requester', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ index: 7 })}
        />,
      );

      expect(screen.getByText('#8')).toBeTruthy();
    });

    it('shows no order number when core did not return index', () => {
      const { container } = render(
        <OperationItem proposal={proposal} operation={createOperation()} />,
      );

      expect(container.textContent).not.toMatch(/#\d/);
    });
  });

  describe('diff control', () => {
    it.each([
      'applied',
      'reverted',
      'revert-refused',
    ] as const)('offers the diff control for an edit in status %s', (status) => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ status })}
        />,
      );

      expect(screen.getByTestId('diff-control')).toBeTruthy();
    });

    it.each([
      'pending',
      'failed',
      'stale',
      'skipped',
    ] as const)('offers no diff control for an operation in status %s', (status) => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ status })}
        />,
      );

      expect(screen.queryByTestId('diff-control')).toBeNull();
    });

    it('offers no diff control for a move', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            type: 'move',
            fromPath: '/a',
            toPath: '/b',
          })}
        />,
      );

      expect(screen.queryByTestId('diff-control')).toBeNull();
    });
  });

  describe('revertability', () => {
    it('shows nothing about revertability when core did not return it', () => {
      const { container } = render(
        <OperationItem proposal={proposal} operation={createOperation()} />,
      );

      expect(container.textContent).not.toContain(
        'change_proposal_viewer.operation.revertible',
      );
      for (const key of Object.values(REVERT_REFUSAL_REASON_LABEL_KEYS)) {
        expect(container.textContent).not.toContain(key);
      }
    });

    it('shows that the operation can be reverted', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ revertability: { revertible: true } })}
        />,
      );

      expect(
        screen.getByText('change_proposal_viewer.operation.revertible'),
      ).toBeTruthy();
    });

    it('shows the refusal reason words when it cannot be reverted', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            revertability: { revertible: false, reason: 'edited-after-apply' },
          })}
        />,
      );

      expect(
        screen.getByText(
          REVERT_REFUSAL_REASON_LABEL_KEYS['edited-after-apply'],
        ),
      ).toBeTruthy();
      expect(
        screen.queryByText('change_proposal_viewer.operation.revertible'),
      ).toBeNull();
    });
  });

  describe('reverted link', () => {
    it('links to the revert Change Proposal', () => {
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({
            status: 'reverted',
            revertedByProposalId: 'rp-123',
          })}
        />,
      );

      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/me/change-proposals/rp-123');
    });

    it('shows no link for an operation that was not reverted', () => {
      render(
        <OperationItem proposal={proposal} operation={createOperation()} />,
      );

      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('requester action slot', () => {
    afterEach(() => {
      delete mocks.slots['ai-chat'];
    });

    it.each(
      STATUSES,
    )('places the operation-level component for the requester when the status is %s', async (status) => {
      mocks.slots['ai-chat'] = {
        operation:
          async () =>
          ({ operation: op }: OperationActionSlotProps) => (
            <span data-testid="op-slot">{op.key}</span>
          ),
      };
      render(
        <OperationItem
          proposal={proposal}
          operation={createOperation({ status })}
        />,
      );

      expect((await screen.findByTestId('op-slot')).textContent).toBe('op-1');
    });

    it('places nothing for a non-requester', async () => {
      const loader = vi.fn();
      mocks.slots['ai-chat'] = { operation: loader };
      render(
        <OperationItem
          proposal={{ ...proposal, isRequester: false }}
          operation={createOperation()}
        />,
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId('op-slot')).toBeNull();
      expect(loader).not.toHaveBeenCalled();
    });
  });
});
