// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ChangeProposalView, OperationView } from '../../../../interfaces';
import { REVERT_REQUEST_MESSAGE_MAX_LENGTH } from '../../../../interfaces';
import type { RevertRequestResult } from '../../stores/proposal-actions';
import { sendRevertRequest } from '../../stores/proposal-actions';
import { RevertRequestModal } from './RevertRequestModal';

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
  sendRevertRequest: vi.fn(),
}));

const PREFIX = 'change_proposal_viewer.revert_request';
const BUTTON = `${PREFIX}.button`;
const SUBMIT = `${PREFIX}.submit`;
const MESSAGE_LABEL = `${PREFIX}.message_label`;
const TOO_LONG_HINT = `${PREFIX}.message_too_long`;

const revertibleOperation: OperationView = {
  key: 'op-1',
  type: 'edit',
  status: 'applied',
  page: { id: 'page-1', path: '/edited' },
  revertability: { revertible: true },
};
const revertedOperation: OperationView = {
  key: 'op-2',
  type: 'edit',
  status: 'reverted',
  page: { id: 'page-2', path: '/reverted' },
};

const createProposal = (
  overrides: Partial<ChangeProposalView> = {},
): ChangeProposalView => ({
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice' },
  entry: 'ai-chat',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'applied',
  isRequester: false,
  operations: [revertibleOperation],
  ...overrides,
});

const deferred = (): {
  readonly promise: Promise<RevertRequestResult>;
  readonly resolve: (value: RevertRequestResult) => void;
} => {
  let resolve: (value: RevertRequestResult) => void = () => {};
  const promise = new Promise<RevertRequestResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const openModal = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: BUTTON }));
};

const typeMessage = (value: string): void => {
  fireEvent.change(screen.getByLabelText(MESSAGE_LABEL), {
    target: { value },
  });
};

describe('RevertRequestModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useIsGuestUser.mockReturnValue(false);
    mocks.useIsReadOnlyUser.mockReturnValue(false);
  });

  describe('visibility', () => {
    it.each([
      ['all operations are revertible', [revertibleOperation]],
      ['all operations are already reverted', [revertedOperation]],
    ])('is shown to a non-requester when %s', (_label, operations) => {
      render(<RevertRequestModal proposal={createProposal({ operations })} />);
      expect(screen.getByRole('button', { name: BUTTON })).toBeTruthy();
    });

    it('is hidden from the requester', () => {
      render(
        <RevertRequestModal proposal={createProposal({ isRequester: true })} />,
      );
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    });

    it('is hidden from a read-only user', () => {
      mocks.useIsReadOnlyUser.mockReturnValue(true);
      render(<RevertRequestModal proposal={createProposal()} />);
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    });

    it('is hidden from a guest', () => {
      mocks.useIsGuestUser.mockReturnValue(true);
      render(<RevertRequestModal proposal={createProposal()} />);
      expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    });
  });

  describe('message length', () => {
    it('cannot send a message over the limit and shows the length hint', async () => {
      render(<RevertRequestModal proposal={createProposal()} />);
      await openModal();
      typeMessage('a'.repeat(REVERT_REQUEST_MESSAGE_MAX_LENGTH + 1));

      const submit = screen.getByRole('button', { name: SUBMIT });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(TOO_LONG_HINT)).toBeTruthy();
      await userEvent.click(submit);
      expect(sendRevertRequest).not.toHaveBeenCalled();
    });

    it('can send a message of exactly the limit', async () => {
      vi.mocked(sendRevertRequest).mockResolvedValue({ type: 'sent' });
      render(<RevertRequestModal proposal={createProposal()} />);
      await openModal();
      const message = 'a'.repeat(REVERT_REQUEST_MESSAGE_MAX_LENGTH);
      typeMessage(message);

      const submit = screen.getByRole('button', { name: SUBMIT });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText(TOO_LONG_HINT)).toBeNull();
      await userEvent.click(submit);
      await waitFor(() =>
        expect(sendRevertRequest).toHaveBeenCalledWith('proposal-1', message),
      );
    });
  });

  describe('sending', () => {
    it('sends the note exactly as typed, untrimmed', async () => {
      vi.mocked(sendRevertRequest).mockResolvedValue({ type: 'sent' });
      render(<RevertRequestModal proposal={createProposal()} />);
      await openModal();
      typeMessage('  please revert  ');
      await userEvent.click(screen.getByRole('button', { name: SUBMIT }));

      await waitFor(() =>
        expect(sendRevertRequest).toHaveBeenCalledWith(
          'proposal-1',
          '  please revert  ',
        ),
      );
    });

    it('sends an empty string when no note is typed', async () => {
      vi.mocked(sendRevertRequest).mockResolvedValue({ type: 'sent' });
      render(<RevertRequestModal proposal={createProposal()} />);
      await openModal();
      await userEvent.click(screen.getByRole('button', { name: SUBMIT }));

      await waitFor(() =>
        expect(sendRevertRequest).toHaveBeenCalledWith('proposal-1', ''),
      );
    });

    it('disables the send button while sending and sends once on a double click', async () => {
      const pending = deferred();
      vi.mocked(sendRevertRequest).mockReturnValue(pending.promise);
      render(<RevertRequestModal proposal={createProposal()} />);
      await openModal();

      const submit = screen.getByRole('button', { name: SUBMIT });
      await userEvent.dblClick(submit);

      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(sendRevertRequest).toHaveBeenCalledTimes(1);

      pending.resolve({ type: 'sent' });
      await waitFor(() =>
        expect(screen.getByText(`${PREFIX}.result.sent`)).toBeTruthy(),
      );
    });
  });

  describe('result', () => {
    const cases: ReadonlyArray<readonly [RevertRequestResult, string]> = [
      [{ type: 'sent' }, 'sent'],
      [{ type: 'error', code: 'not-found' }, 'not_found'],
      [{ type: 'error', code: 'message-too-long' }, 'too_long'],
      [{ type: 'error', code: 'recently-requested' }, 'recently_sent'],
      [{ type: 'error', code: 'own-proposal' }, 'own_proposal'],
      [
        { type: 'error', code: 'requester-unavailable' },
        'requester_unavailable',
      ],
      [{ type: 'error', code: 'unknown' }, 'error'],
    ];

    it.each(cases)('shows the message for %j', async (result, key) => {
      vi.mocked(sendRevertRequest).mockResolvedValue(result);
      render(<RevertRequestModal proposal={createProposal()} />);
      await openModal();
      await userEvent.click(screen.getByRole('button', { name: SUBMIT }));

      await waitFor(() =>
        expect(screen.getByText(`${PREFIX}.result.${key}`)).toBeTruthy(),
      );
    });
  });
});
