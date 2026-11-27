// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import type { OperationView, RevertResult } from '../../../../interfaces';
import {
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  REVERT_REFUSAL_REASON_LABEL_KEYS,
} from '../../../shared';
import type { RevertProgressEntry } from '../../domain';
import type { RevertProgressState } from '../../stores/use-revert-progress';
import { useRevertProgress } from '../../stores/use-revert-progress';
import type { RevertRun } from './RevertResultList';
import { RevertResultList } from './RevertResultList';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../stores/use-revert-progress', () => ({
  useRevertProgress: vi.fn(),
}));

const mockProgress = (
  entries: readonly RevertProgressEntry[],
  overrides: Partial<RevertProgressState> = {},
): void => {
  vi.mocked(useRevertProgress).mockReturnValue({
    entries,
    isSettled: entries.every((e) => e.state !== 'in-progress'),
    isTimedOut: false,
    ...overrides,
  });
};

const result: RevertResult = {
  revertProposalId: 'revert-1',
  operations: [{ key: 'op-a', outcome: 'reverted' }],
};

const createRun = (
  targets: RevertRun['targets'] = [
    { key: 'op-a', path: '/a' },
    { key: 'op-b', path: '/b' },
  ],
): RevertRun => ({
  result,
  targets,
  sentKeys: targets.map((target) => target.key),
});

const originalOperations: readonly OperationView[] = [
  { key: 'op-a', type: 'edit', status: 'applied' },
];

const rowOf = (path: string): HTMLElement => {
  const row = screen.getByText(path).closest('li');
  if (row == null) {
    throw new Error(`no row for ${path}`);
  }
  return row;
};

describe('RevertResultList', () => {
  beforeEach(() => {
    vi.mocked(useRevertProgress).mockReset();
  });

  it('hands the run to the progress hook as the same references on every render', () => {
    const run = createRun();
    mockProgress([
      { key: 'op-a', state: 'reverted' },
      { key: 'op-b', state: 'reverted' },
    ]);
    const { rerender } = render(
      <RevertResultList
        proposalId="proposal-1"
        run={run}
        originalOperations={originalOperations}
      />,
    );
    rerender(
      <RevertResultList
        proposalId="proposal-1"
        run={run}
        originalOperations={originalOperations}
      />,
    );

    const calls = vi.mocked(useRevertProgress).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [args] of calls) {
      expect(args.originalProposalId).toBe('proposal-1');
      expect(args.result).toBe(run.result);
      expect(args.sentKeys).toBe(run.sentKeys);
      expect(args.originalOperations).toBe(originalOperations);
    }
  });

  it('shows the title and every sent operation with its path', () => {
    mockProgress([
      { key: 'op-a', state: 'reverted' },
      { key: 'op-b', state: 'not-targeted' },
    ]);
    render(
      <RevertResultList
        proposalId="p"
        run={createRun()}
        originalOperations={[]}
      />,
    );
    expect(
      screen.getByText('change_proposal_viewer.revert_all.result_title'),
    ).toBeTruthy();
    expect(screen.getByText('/a')).toBeTruthy();
    expect(screen.getByText('/b')).toBeTruthy();
  });

  it('shows the words for each state of an operation', () => {
    const targets = [
      { key: 'k-reverted', path: '/reverted' },
      { key: 'k-refused', path: '/refused' },
      { key: 'k-refused-bare', path: '/refused-bare' },
      { key: 'k-skipped', path: '/skipped' },
      { key: 'k-progress', path: '/progress' },
      { key: 'k-not-targeted', path: '/not-targeted' },
    ];
    mockProgress([
      { key: 'k-reverted', state: 'reverted' },
      { key: 'k-refused', state: 'revert-refused', reason: 'has-children' },
      { key: 'k-refused-bare', state: 'revert-refused' },
      { key: 'k-skipped', state: 'skipped', reason: 'page-being-edited' },
      { key: 'k-progress', state: 'in-progress' },
      { key: 'k-not-targeted', state: 'not-targeted' },
    ]);
    render(
      <RevertResultList
        proposalId="p"
        run={createRun(targets)}
        originalOperations={[]}
      />,
    );

    expect(rowOf('/reverted').textContent).toContain(
      OPERATION_STATUS_LABEL_KEYS.reverted,
    );
    expect(rowOf('/refused').textContent).toContain(
      REVERT_REFUSAL_REASON_LABEL_KEYS['has-children'],
    );
    const bare = rowOf('/refused-bare').textContent ?? '';
    expect(bare).toContain(OPERATION_STATUS_LABEL_KEYS['revert-refused']);
    expect(bare).not.toContain('change_proposal.revert_refusal_reason.');
    expect(rowOf('/skipped').textContent).toContain(
      OPERATION_REASON_LABEL_KEYS['page-being-edited'],
    );
    expect(rowOf('/progress').textContent).toContain(
      'change_proposal_viewer.revert_result.in_progress',
    );
    expect(rowOf('/not-targeted').textContent).toContain(
      'change_proposal_viewer.revert_result.not_targeted',
    );
  });

  it('turns an in-progress operation into its result when the progress resolves', () => {
    const run = createRun();
    mockProgress([
      { key: 'op-a', state: 'reverted' },
      { key: 'op-b', state: 'in-progress' },
    ]);
    const { rerender } = render(
      <RevertResultList proposalId="p" run={run} originalOperations={[]} />,
    );
    expect(rowOf('/b').textContent).toContain(
      'change_proposal_viewer.revert_result.in_progress',
    );

    mockProgress([
      { key: 'op-a', state: 'reverted' },
      { key: 'op-b', state: 'reverted' },
    ]);
    rerender(
      <RevertResultList proposalId="p" run={run} originalOperations={[]} />,
    );
    const row = rowOf('/b').textContent ?? '';
    expect(row).not.toContain(
      'change_proposal_viewer.revert_result.in_progress',
    );
    expect(row).toContain(OPERATION_STATUS_LABEL_KEYS.reverted);
  });

  it('asks to reload later only when polling timed out', () => {
    const run = createRun();
    const entries: readonly RevertProgressEntry[] = [
      { key: 'op-a', state: 'reverted' },
      { key: 'op-b', state: 'in-progress' },
    ];
    mockProgress(entries);
    const { rerender } = render(
      <RevertResultList proposalId="p" run={run} originalOperations={[]} />,
    );
    expect(
      screen.queryByText('change_proposal_viewer.revert_result.timed_out'),
    ).toBeNull();

    mockProgress(entries, { isTimedOut: true });
    rerender(
      <RevertResultList proposalId="p" run={run} originalOperations={[]} />,
    );
    expect(
      screen.getByText('change_proposal_viewer.revert_result.timed_out'),
    ).toBeTruthy();
  });

  it('shows the page-gone text for an operation sent without a path', () => {
    mockProgress([{ key: 'op-a', state: 'reverted' }]);
    render(
      <RevertResultList
        proposalId="p"
        run={createRun([{ key: 'op-a' }])}
        originalOperations={[]}
      />,
    );
    expect(
      screen.getByText('change_proposal_viewer.operation.page_gone'),
    ).toBeTruthy();
  });
});
