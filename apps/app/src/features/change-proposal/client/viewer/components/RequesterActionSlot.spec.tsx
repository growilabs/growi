// @vitest-environment happy-dom

import type { ComponentType, JSX } from 'react';
import { render, screen } from '@testing-library/react';

import type { ChangeProposalView, OperationView } from '../../../interfaces';
import { RequesterActionSlot } from './RequesterActionSlot';
import type {
  OperationActionSlotProps,
  ProposalActionSlotProps,
} from './requester-action-slots';

const mocks = vi.hoisted(() => {
  const slots: Record<string, unknown> = {};
  return { proposalLoader: vi.fn(), operationLoader: vi.fn(), slots };
});

vi.mock('./requester-action-slots', () => ({
  REQUESTER_ACTION_SLOTS: mocks.slots,
}));

const ProposalPlaceholder = ({
  proposal,
}: ProposalActionSlotProps): JSX.Element => (
  <div data-testid="proposal-slot">{proposal.id}</div>
);

const OperationPlaceholder = ({
  proposal,
  operation,
}: OperationActionSlotProps): JSX.Element => (
  <div data-testid="operation-slot">{`${proposal.id}:${operation.key}`}</div>
);

const operation: OperationView = {
  key: 'op-1',
  type: 'edit',
  status: 'applied',
  path: '/a',
};

const createProposal = (
  overrides: Partial<ChangeProposalView> = {},
): ChangeProposalView => ({
  id: 'proposal-1',
  requester: { id: 'user-1', username: 'alice', name: 'Alice' },
  entry: 'ai-chat',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'pending',
  isRequester: true,
  operations: [operation],
  ...overrides,
});

describe('RequesterActionSlot', () => {
  beforeEach(() => {
    mocks.proposalLoader.mockReset();
    mocks.operationLoader.mockReset();
    mocks.proposalLoader.mockImplementation(
      async (): Promise<ComponentType<ProposalActionSlotProps>> =>
        ProposalPlaceholder,
    );
    mocks.operationLoader.mockImplementation(
      async (): Promise<ComponentType<OperationActionSlotProps>> =>
        OperationPlaceholder,
    );
    for (const key of Object.keys(mocks.slots)) {
      delete mocks.slots[key];
    }
    mocks.slots['ai-chat'] = {
      proposal: mocks.proposalLoader,
      operation: mocks.operationLoader,
    };
  });

  it('renders the proposal-level component for the requester', async () => {
    render(<RequesterActionSlot proposal={createProposal()} />);

    const content = await screen.findByTestId('proposal-slot');
    expect(content.textContent).toBe('proposal-1');
    expect(mocks.operationLoader).not.toHaveBeenCalled();
  });

  it('renders the operation-level component with the proposal and the operation', async () => {
    render(
      <RequesterActionSlot proposal={createProposal()} operation={operation} />,
    );

    const content = await screen.findByTestId('operation-slot');
    expect(content.textContent).toBe('proposal-1:op-1');
    expect(mocks.proposalLoader).not.toHaveBeenCalled();
  });

  it('renders nothing and never loads a component for a non-requester', async () => {
    const proposal = createProposal({ isRequester: false });
    const { container } = render(
      <>
        <RequesterActionSlot proposal={proposal} />
        <RequesterActionSlot proposal={proposal} operation={operation} />
      </>,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(mocks.proposalLoader).not.toHaveBeenCalled();
    expect(mocks.operationLoader).not.toHaveBeenCalled();
  });

  it('renders nothing when the table has no row for the entry', async () => {
    const proposal = createProposal({ entry: 'vault' });
    const { container } = render(
      <>
        <RequesterActionSlot proposal={proposal} />
        <RequesterActionSlot proposal={proposal} operation={operation} />
      </>,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(mocks.proposalLoader).not.toHaveBeenCalled();
    expect(mocks.operationLoader).not.toHaveBeenCalled();
  });

  it('renders nothing when the row has no loader for the requested slot kind', async () => {
    mocks.slots['ai-chat'] = { proposal: mocks.proposalLoader };
    const { container } = render(
      <RequesterActionSlot proposal={createProposal()} operation={operation} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
    expect(mocks.operationLoader).not.toHaveBeenCalled();
  });
});
