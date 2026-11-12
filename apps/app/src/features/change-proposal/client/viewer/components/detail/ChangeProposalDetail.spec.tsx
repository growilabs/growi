// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/react';
import { format } from 'date-fns/format';
import type { SWRResponse } from 'swr';

import type { ChangeProposalView, OperationView } from '../../../../interfaces';
import { buildProposalHref, PROPOSAL_STATUS_LABEL_KEYS } from '../../../shared';
import { ENTRY_LABEL_KEYS } from '../../domain';
import type { ChangeProposalFetchResult } from '../../stores/use-swrx-change-proposal';
import { useSWRxChangeProposal } from '../../stores/use-swrx-change-proposal';
import { ChangeProposalDetail } from './ChangeProposalDetail';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../stores/use-swrx-change-proposal', () => ({
  useSWRxChangeProposal: vi.fn(),
}));

vi.mock('../OperationItem', () => ({
  OperationItem: ({ operation }: { operation: OperationView }) => (
    <div data-testid="operation-item">{operation.key}</div>
  ),
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
      screen.getAllByTestId('operation-item').map((el) => el.textContent),
    ).toEqual(['op-z', 'op-a', 'op-m']);
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
    expect(screen.queryAllByTestId('operation-item')).toHaveLength(0);
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
