// @vitest-environment happy-dom

import type { ComponentType, JSX } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns/format';
import type { SWRResponse } from 'swr';

import type {
  ChangeProposalView,
  OperationView,
  RevertResult,
} from '../../../../interfaces';
import {
  buildProposalHref,
  OPERATION_STATUS_LABEL_KEYS,
  PROPOSAL_STATUS_LABEL_KEYS,
} from '../../../shared';
import { ENTRY_LABEL_KEYS } from '../../domain';
import { revertOperations } from '../../stores/proposal-actions';
import { useRevertProgress } from '../../stores/use-revert-progress';
import type { ChangeProposalFetchResult } from '../../stores/use-swrx-change-proposal';
import { useSWRxChangeProposal } from '../../stores/use-swrx-change-proposal';
import type { RequesterOnlySectionProps } from '../requester-only-sections';
import { ChangeProposalDetail } from './ChangeProposalDetail';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../stores/use-swrx-change-proposal', () => ({
  useSWRxChangeProposal: vi.fn(),
}));

vi.mock('../OperationDiff', () => ({
  OperationDiff: () => null,
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: () => false,
  useIsReadOnlyUser: () => false,
}));

vi.mock('../../stores/proposal-actions', () => ({
  revertOperations: vi.fn(),
  sendRevertRequest: vi.fn(),
}));

vi.mock('../../stores/use-revert-progress', () => ({
  useRevertProgress: vi.fn(),
}));

const requesterOnlyMocks = vi.hoisted(() => {
  const sections: Record<string, unknown> = {};
  return { loader: vi.fn(), sections };
});

vi.mock('../requester-only-sections', () => ({
  REQUESTER_ONLY_SECTIONS: requesterOnlyMocks.sections,
}));

const DATE_FORMAT = 'yyyy/MM/dd HH:mm:ss';

const createOperation = (key: string): OperationView => ({
  key,
  type: 'edit',
  status: 'applied',
  page: { id: `page-${key}`, path: `/path/${key}` },
  baseRevisionId: 'rev-base',
  resultRevisionId: 'rev-result',
});

const createProposal = (
  overrides: Partial<ChangeProposalView> = {},
): ChangeProposalView => ({
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice Smith' },
  entry: 'ai-chat',
  modelLabel: 'model-x',
  createdAt: '2026-03-04T05:06:07.000Z',
  lastAppliedAt: '2026-03-05T08:09:10.000Z',
  status: 'applied',
  isRequester: false,
  operations: [createOperation('op-a'), createOperation('op-b')],
  ...overrides,
});

const mockFetch = (
  response: Partial<SWRResponse<ChangeProposalFetchResult, Error>>,
): void => {
  vi.mocked(useSWRxChangeProposal).mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
    ...response,
  });
};

const mockFound = (proposal: ChangeProposalView): void =>
  mockFetch({ data: { type: 'found', proposal } });

describe('ChangeProposalDetail', () => {
  beforeEach(() => {
    vi.mocked(useSWRxChangeProposal).mockReset();
  });

  it('fetches the proposal with the given id', () => {
    mockFound(createProposal());
    render(<ChangeProposalDetail proposalId="proposal-1" />);
    expect(useSWRxChangeProposal).toHaveBeenCalledWith('proposal-1');
  });

  it('shows the header fields of a found proposal', () => {
    const proposal = createProposal();
    mockFound(proposal);
    render(<ChangeProposalDetail proposalId="proposal-1" />);

    expect(screen.getByText(/Alice Smith/)).toBeTruthy();
    expect(screen.getByText(ENTRY_LABEL_KEYS['ai-chat'])).toBeTruthy();
    expect(screen.getByText('model-x')).toBeTruthy();
    expect(
      screen.getByText(format(new Date(proposal.createdAt), DATE_FORMAT)),
    ).toBeTruthy();
    expect(
      screen.getByText(PROPOSAL_STATUS_LABEL_KEYS[proposal.status]),
    ).toBeTruthy();
  });

  it('shows lastAppliedAt exactly as given and omits it when absent', () => {
    const lastAppliedAt = '2026-07-08T01:02:03.000Z';
    mockFound(createProposal({ lastAppliedAt }));
    const { unmount } = render(<ChangeProposalDetail proposalId="p" />);
    expect(
      screen.getByText(format(new Date(lastAppliedAt), DATE_FORMAT)),
    ).toBeTruthy();
    expect(
      screen.getByText('change_proposal_viewer.detail.last_applied_at'),
    ).toBeTruthy();
    unmount();

    mockFound(createProposal({ lastAppliedAt: undefined }));
    render(<ChangeProposalDetail proposalId="p" />);
    expect(
      screen.queryByText('change_proposal_viewer.detail.last_applied_at'),
    ).toBeNull();
  });

  it('renders operations in the response order', () => {
    mockFound(
      createProposal({
        operations: [
          createOperation('op-z'),
          createOperation('op-a'),
          createOperation('op-m'),
        ],
      }),
    );
    render(<ChangeProposalDetail proposalId="p" />);
    expect(
      screen.getAllByText(/^\/path\//).map((el) => el.textContent),
    ).toEqual(['/path/op-z', '/path/op-a', '/path/op-m']);
  });

  it('links a revert proposal to the original proposal', () => {
    mockFound(
      createProposal({ entry: 'revert', revertOf: 'original-proposal-id' }),
    );
    render(<ChangeProposalDetail proposalId="p" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(
      buildProposalHref('original-proposal-id'),
    );
  });

  it('shows no link for a proposal that is not a revert', () => {
    mockFound(createProposal());
    render(<ChangeProposalDetail proposalId="p" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows one not-found display and no proposal content', () => {
    mockFetch({ data: { type: 'not-found' } });
    render(<ChangeProposalDetail proposalId="p" />);
    expect(
      screen.getByText('change_proposal_viewer.detail.not_found'),
    ).toBeTruthy();
    expect(
      screen.queryByText('change_proposal_viewer.detail.error'),
    ).toBeNull();
    expect(screen.queryByText(/^\/path\//)).toBeNull();
  });

  it('shows a different display for a communication failure', () => {
    mockFetch({ error: new Error('network') });
    render(<ChangeProposalDetail proposalId="p" />);
    expect(
      screen.getByText('change_proposal_viewer.detail.error'),
    ).toBeTruthy();
    expect(
      screen.queryByText('change_proposal_viewer.detail.not_found'),
    ).toBeNull();
  });

  it('shows neither not-found nor error while loading', () => {
    mockFetch({ isLoading: true });
    render(<ChangeProposalDetail proposalId="p" />);
    expect(
      screen.queryByText('change_proposal_viewer.detail.not_found'),
    ).toBeNull();
    expect(
      screen.queryByText('change_proposal_viewer.detail.error'),
    ).toBeNull();
  });

  it('renders no digit that stands for a count of operations', () => {
    mockFound(
      createProposal({
        operations: [
          createOperation('op-a'),
          createOperation('op-b'),
          createOperation('op-c'),
        ],
      }),
    );
    const { container } = render(<ChangeProposalDetail proposalId="p" />);
    const header = within(container).getByText(
      'change_proposal_viewer.detail.operations',
    );
    expect(header.textContent).not.toMatch(/\d/);
    expect(header.parentElement?.textContent ?? '').not.toMatch(/\(\d+\)/);
  });
});

describe('ChangeProposalDetail with a revert', () => {
  const BUTTON = 'change_proposal_viewer.revert_all.button';
  const SUBMIT = 'change_proposal_viewer.revert_all.confirm_submit';
  const RESULT_TITLE = 'change_proposal_viewer.revert_all.result_title';
  const NOT_FOUND = 'change_proposal_viewer.detail.not_found';

  const revertibleCreate: OperationView = {
    key: 'op-create',
    type: 'create',
    status: 'applied',
    page: { id: 'page-created', path: '/created-page' },
    path: '/created-page',
    resultRevisionId: 'rev-created',
    revertability: { revertible: true },
  };
  const result: RevertResult = {
    revertProposalId: 'revert-1',
    operations: [{ key: 'op-create', outcome: 'reverted' }],
  };
  const beforeRevert = createProposal({ operations: [revertibleCreate] });

  beforeEach(() => {
    vi.mocked(useSWRxChangeProposal).mockReset();
    vi.mocked(revertOperations).mockReset();
    vi.mocked(useRevertProgress).mockReset();
    vi.mocked(useRevertProgress).mockImplementation(({ sentKeys }) => ({
      entries: sentKeys.map((key) => ({ key, state: 'reverted' as const })),
      isSettled: true,
      isTimedOut: false,
    }));
  });

  const revertAll = async (): Promise<void> => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: BUTTON }));
    await user.click(await screen.findByRole('button', { name: SUBMIT }));
  };

  it('shows the result list with the result of the revert', async () => {
    vi.mocked(revertOperations).mockResolvedValue({ type: 'done', result });
    mockFound(beforeRevert);
    render(<ChangeProposalDetail proposalId="proposal-1" />);

    await revertAll();

    expect(await screen.findByText(RESULT_TITLE)).toBeTruthy();
    expect(revertOperations).toHaveBeenCalledWith('proposal-1', ['op-create']);
    const [args] = vi.mocked(useRevertProgress).mock.calls.at(-1) ?? [];
    expect(args?.result).toBe(result);
    expect(args?.originalProposalId).toBe('proposal-1');
  });

  it('keeps the reverted create with its path and the result list after the refetch', async () => {
    vi.mocked(revertOperations).mockResolvedValue({ type: 'done', result });
    mockFound(beforeRevert);
    const { rerender } = render(
      <ChangeProposalDetail proposalId="proposal-1" />,
    );
    await revertAll();
    await screen.findByText(RESULT_TITLE);

    // The page made by the create was deleted completely by the revert.
    mockFound(
      createProposal({
        status: 'reverted',
        operations: [
          {
            key: 'op-create',
            type: 'create',
            status: 'reverted',
            path: '/created-page',
            revertedByProposalId: 'revert-1',
          },
        ],
      }),
    );
    rerender(<ChangeProposalDetail proposalId="proposal-1" />);

    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    expect(screen.getByText(RESULT_TITLE)).toBeTruthy();
    const operationSection = screen
      .getByText('change_proposal_viewer.detail.operations')
      .closest('section');
    if (operationSection == null) {
      throw new Error('no operations section');
    }
    expect(within(operationSection).getByText('/created-page')).toBeTruthy();
    expect(
      within(operationSection).getByText(OPERATION_STATUS_LABEL_KEYS.reverted),
    ).toBeTruthy();
  });

  it('keeps the last display and the result list when the refetch says not-found while a result is shown', async () => {
    vi.mocked(revertOperations).mockResolvedValue({ type: 'done', result });
    mockFound(beforeRevert);
    const { rerender } = render(
      <ChangeProposalDetail proposalId="proposal-1" />,
    );
    await revertAll();
    await screen.findByText(RESULT_TITLE);

    mockFetch({ data: { type: 'not-found' } });
    rerender(<ChangeProposalDetail proposalId="proposal-1" />);

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.getByText(RESULT_TITLE)).toBeTruthy();
    expect(screen.getByText(/Alice Smith/)).toBeTruthy();
    expect(screen.getAllByText('/created-page').length).toBeGreaterThan(0);
  });

  it('shows not-found when the refetch says not-found and no result is shown', () => {
    mockFound(beforeRevert);
    const { rerender } = render(
      <ChangeProposalDetail proposalId="proposal-1" />,
    );

    mockFetch({ data: { type: 'not-found' } });
    rerender(<ChangeProposalDetail proposalId="proposal-1" />);

    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(screen.queryByText('/created-page')).toBeNull();
  });

  it('drops the result and the kept display when another proposal is opened', async () => {
    vi.mocked(revertOperations).mockResolvedValue({ type: 'done', result });
    mockFound(beforeRevert);
    const { rerender } = render(
      <ChangeProposalDetail proposalId="proposal-1" />,
    );
    await revertAll();
    await screen.findByText(RESULT_TITLE);

    mockFetch({ data: { type: 'not-found' } });
    rerender(<ChangeProposalDetail proposalId="proposal-2" />);

    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(screen.queryByText(RESULT_TITLE)).toBeNull();
  });

  it('starts a new revert while an earlier result is shown', async () => {
    const resultA: RevertResult = {
      revertProposalId: 'revert-a',
      operations: [{ key: 'op-create', outcome: 'reverted' }],
    };
    const resultB: RevertResult = {
      revertProposalId: 'revert-b',
      operations: [{ key: 'op-b', outcome: 'reverted' }],
    };
    vi.mocked(revertOperations)
      .mockResolvedValueOnce({ type: 'done', result: resultA })
      .mockResolvedValueOnce({ type: 'done', result: resultB });
    mockFound(beforeRevert);
    const { rerender } = render(
      <ChangeProposalDetail proposalId="proposal-1" />,
    );
    await revertAll();
    await screen.findByText(RESULT_TITLE);

    mockFound(
      createProposal({
        operations: [
          { ...revertibleCreate, revertability: undefined },
          {
            key: 'op-b',
            type: 'edit',
            status: 'applied',
            page: { id: 'page-b', path: '/second-page' },
            revertability: { revertible: true },
          },
        ],
      }),
    );
    rerender(<ChangeProposalDetail proposalId="proposal-1" />);
    await revertAll();

    await waitFor(() => {
      const [args] = vi.mocked(useRevertProgress).mock.calls.at(-1) ?? [];
      expect(args?.result).toBe(resultB);
      expect(args?.sentKeys).toEqual(['op-b']);
    });
    expect(revertOperations).toHaveBeenLastCalledWith('proposal-1', ['op-b']);
    const resultList = screen.getByText(RESULT_TITLE).closest('section');
    if (resultList == null) {
      throw new Error('no result list');
    }
    expect(within(resultList).getByText('/second-page')).toBeTruthy();
    expect(within(resultList).queryByText('/created-page')).toBeNull();
  });

  it('shows an error and leaves the detail unchanged when the revert fails', async () => {
    vi.mocked(revertOperations).mockResolvedValue({ type: 'error' });
    mockFound(beforeRevert);
    render(<ChangeProposalDetail proposalId="proposal-1" />);

    await revertAll();

    expect(
      await screen.findByText('change_proposal_viewer.revert_all.error'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.queryByText('change_proposal_viewer.revert_all.confirm_title'),
      ).toBeNull();
    });
    expect(screen.queryByText(RESULT_TITLE)).toBeNull();
    expect(screen.getByRole('button', { name: BUTTON })).toBeTruthy();
    expect(screen.getByText('/created-page')).toBeTruthy();
  });
});

describe('ChangeProposalDetail revert request', () => {
  const REQUEST_BUTTON = 'change_proposal_viewer.revert_request.button';

  beforeEach(() => {
    vi.mocked(useSWRxChangeProposal).mockReset();
  });

  it('offers the revert request to a non-requester', () => {
    mockFound(createProposal({ isRequester: false }));
    render(<ChangeProposalDetail proposalId="proposal-1" />);
    expect(screen.getByRole('button', { name: REQUEST_BUTTON })).toBeTruthy();
  });

  it('does not offer the revert request to the requester', () => {
    mockFound(createProposal({ isRequester: true }));
    render(<ChangeProposalDetail proposalId="proposal-1" />);
    expect(screen.queryByRole('button', { name: REQUEST_BUTTON })).toBeNull();
  });
});

describe('ChangeProposalDetail requester-only area', () => {
  const PlaceholderSection = ({
    proposalId,
  }: RequesterOnlySectionProps): JSX.Element => (
    <div data-testid="requester-only-placeholder">{proposalId}</div>
  );

  beforeEach(() => {
    vi.mocked(useSWRxChangeProposal).mockReset();
    requesterOnlyMocks.loader.mockReset();
    requesterOnlyMocks.loader.mockImplementation(
      async (): Promise<ComponentType<RequesterOnlySectionProps>> =>
        PlaceholderSection,
    );
    for (const key of Object.keys(requesterOnlyMocks.sections)) {
      delete requesterOnlyMocks.sections[key];
    }
    requesterOnlyMocks.sections['ai-chat'] = requesterOnlyMocks.loader;
  });

  it('shows the registered placeholder to the requester with the proposal id', async () => {
    mockFound(createProposal({ isRequester: true }));
    render(<ChangeProposalDetail proposalId="proposal-1" />);

    const placeholder = await screen.findByTestId('requester-only-placeholder');
    expect(placeholder.textContent).toBe('proposal-1');
  });

  it('shows no requester-only area and never loads it for a non-requester', async () => {
    mockFound(createProposal({ isRequester: false }));
    render(<ChangeProposalDetail proposalId="proposal-1" />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId('requester-only-placeholder')).toBeNull();
    expect(requesterOnlyMocks.loader).not.toHaveBeenCalled();
  });
});
