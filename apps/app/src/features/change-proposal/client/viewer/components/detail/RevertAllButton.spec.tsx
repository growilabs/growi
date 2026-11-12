// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {
  ChangeProposalView,
  OperationView,
  RevertResult,
} from '../../../../interfaces';
import type { RevertActionResult } from '../../stores/proposal-actions';
import { revertOperations } from '../../stores/proposal-actions';
import { RevertAllButton } from './RevertAllButton';

const mocks = vi.hoisted(() => ({
  useIsGuestUser: vi.fn<() => boolean>(),
  useIsReadOnlyUser: vi.fn<() => boolean>(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/states/context', () => ({
  useIsGuestUser: mocks.useIsGuestUser,
  useIsReadOnlyUser: mocks.useIsReadOnlyUser,
}));
vi.mock('../../stores/proposal-actions', () => ({
  revertOperations: vi.fn(),
}));

const BUTTON = 'change_proposal_viewer.revert_all.button';
const SUBMIT = 'change_proposal_viewer.revert_all.confirm_submit';
const CONFIRM_TITLE = 'change_proposal_viewer.revert_all.confirm_title';
const ERROR = 'change_proposal_viewer.revert_all.error';

const revertibleEdit: OperationView = {
  key: 'op-edit',
  type: 'edit',
  status: 'applied',
  page: { id: 'page-1', path: '/edited' },
  path: '/edited-recorded',
  revertability: { revertible: true },
};
const notRevertible: OperationView = {
  key: 'op-blocked',
  type: 'edit',
  status: 'applied',
  page: { id: 'page-2', path: '/blocked' },
  revertability: { revertible: false, reason: 'edited-after-apply' },
};
const noJudgement: OperationView = {
  key: 'op-unjudged',
  type: 'create',
  status: 'reverted',
  path: '/unjudged',
};
const revertibleCreate: OperationView = {
  key: 'op-create',
  type: 'create',
  status: 'applied',
  path: '/created',
  revertability: { revertible: true },
};
const revertibleMove: OperationView = {
  key: 'op-move',
  type: 'move',
  status: 'applied',
  fromPath: '/from',
  toPath: '/to',
  revertability: { revertible: true },
};

const createProposal = (
  operations: readonly OperationView[],
): ChangeProposalView => ({
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice' },
  entry: 'ai-chat',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'applied',
  isRequester: false,
  operations,
});

const result: RevertResult = {
  revertProposalId: 'revert-1',
  operations: [{ key: 'op-edit', outcome: 'reverted' }],
};

const deferred = (): {
  readonly promise: Promise<RevertActionResult>;
  readonly resolve: (value: RevertActionResult) => void;
} => {
  let resolve: (value: RevertActionResult) => void = () => {};
  const promise = new Promise<RevertActionResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('RevertAllButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useIsGuestUser.mockReturnValue(false);
    mocks.useIsReadOnlyUser.mockReturnValue(false);
  });

  describe('visibility', () => {
    it('is hidden when no operation is revertible', () => {
      render(
        <RevertAllButton
          proposal={createProposal([notRevertible, noJudgement])}
          onReverted={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    });

    it('is hidden from a guest', () => {
      mocks.useIsGuestUser.mockReturnValue(true);
      render(
        <RevertAllButton
          proposal={createProposal([revertibleEdit])}
          onReverted={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    });

    it('is hidden from a read-only user', () => {
      mocks.useIsReadOnlyUser.mockReturnValue(true);
      render(
        <RevertAllButton
          proposal={createProposal([revertibleEdit])}
          onReverted={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    });

    it('is shown when other operations are not revertible or carry no judgement', () => {
      render(
        <RevertAllButton
          proposal={createProposal([
            notRevertible,
            noJudgement,
            revertibleEdit,
          ])}
          onReverted={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: BUTTON })).toBeTruthy();
    });
  });

  describe('confirmation', () => {
    it('lists the paths of only the revertible operations', async () => {
      const user = userEvent.setup();
      render(
        <RevertAllButton
          proposal={createProposal([
            revertibleEdit,
            notRevertible,
            revertibleCreate,
            revertibleMove,
          ])}
          onReverted={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: BUTTON }));

      expect(await screen.findByText(CONFIRM_TITLE)).toBeTruthy();
      expect(screen.getByText('/edited')).toBeTruthy();
      expect(screen.getByText('/created')).toBeTruthy();
      expect(screen.getByText('/to')).toBeTruthy();
      expect(screen.queryByText('/blocked')).toBeNull();
      expect(screen.queryByText('/edited-recorded')).toBeNull();
    });

    it('sends nothing when the viewer cancels', async () => {
      const user = userEvent.setup();
      render(
        <RevertAllButton
          proposal={createProposal([revertibleEdit])}
          onReverted={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: BUTTON }));
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByText(CONFIRM_TITLE)).toBeNull();
      });
      expect(revertOperations).not.toHaveBeenCalled();
    });
  });

  describe('sending', () => {
    it('sends the keys of only the revertible operations and hands over the result', async () => {
      vi.mocked(revertOperations).mockResolvedValue({ type: 'done', result });
      const onReverted = vi.fn();
      const user = userEvent.setup();
      render(
        <RevertAllButton
          proposal={createProposal([
            revertibleEdit,
            notRevertible,
            noJudgement,
            revertibleCreate,
          ])}
          onReverted={onReverted}
        />,
      );
      await user.click(screen.getByRole('button', { name: BUTTON }));
      await user.click(await screen.findByRole('button', { name: SUBMIT }));

      expect(revertOperations).toHaveBeenCalledTimes(1);
      expect(revertOperations).toHaveBeenCalledWith('proposal-1', [
        'op-edit',
        'op-create',
      ]);
      await waitFor(() => expect(onReverted).toHaveBeenCalledTimes(1));
      const [run] = onReverted.mock.calls[0];
      expect(run.result).toBe(result);
      expect(run.sentKeys).toEqual(['op-edit', 'op-create']);
      expect(run.targets).toEqual([
        { key: 'op-edit', path: '/edited' },
        { key: 'op-create', path: '/created' },
      ]);
    });

    it('sends once and disables the buttons while sending', async () => {
      const pending = deferred();
      vi.mocked(revertOperations).mockReturnValue(pending.promise);
      const user = userEvent.setup();
      render(
        <RevertAllButton
          proposal={createProposal([revertibleEdit])}
          onReverted={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: BUTTON }));
      const submit = await screen.findByRole('button', { name: SUBMIT });

      fireEvent.click(submit);
      fireEvent.click(submit);

      expect(revertOperations).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(submit.hasAttribute('disabled')).toBe(true);
      });
      const opener = screen
        .getAllByRole('button', { name: BUTTON, hidden: true })
        .at(0);
      expect(opener?.hasAttribute('disabled')).toBe(true);

      pending.resolve({ type: 'done', result });
      await waitFor(() => {
        expect(screen.queryByText(CONFIRM_TITLE)).toBeNull();
      });
    });

    it.each<RevertActionResult>([
      { type: 'error' },
      { type: 'not-found' },
    ])('shows an error and hands over nothing when the request ends with $type', async (outcome) => {
      vi.mocked(revertOperations).mockResolvedValue(outcome);
      const onReverted = vi.fn();
      const user = userEvent.setup();
      render(
        <RevertAllButton
          proposal={createProposal([revertibleEdit])}
          onReverted={onReverted}
        />,
      );
      await user.click(screen.getByRole('button', { name: BUTTON }));
      await user.click(await screen.findByRole('button', { name: SUBMIT }));

      expect(await screen.findByText(ERROR)).toBeTruthy();
      expect(onReverted).not.toHaveBeenCalled();
    });
  });
});
