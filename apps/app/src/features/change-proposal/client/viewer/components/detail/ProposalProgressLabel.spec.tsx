// @vitest-environment happy-dom

import { render } from '@testing-library/react';

import type {
  ChangeProposalView,
  ProposalAchievement,
  ProposalLifecycle,
} from '../../../../interfaces';
import { ProposalProgressLabel } from './ProposalProgressLabel';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options == null ? key : `${key}|${JSON.stringify(options)}`,
  }),
}));

const createView = (
  lifecycle: ProposalLifecycle,
  achievement?: ProposalAchievement,
): Pick<ChangeProposalView, 'requesterState'> => ({
  requesterState: {
    lifecycle,
    achievement,
    perPageNotifications: { value: false, isEnabledBySettings: false },
  },
});

describe('ProposalProgressLabel', () => {
  it('shows the achievement percent of a settled proposal, floored', () => {
    const { container } = render(
      <ProposalProgressLabel
        view={createView('settled', { applied: 2, attempted: 3 })}
      />,
    );
    expect(container.textContent).toBe(
      'change_proposal.achievement.settled_with_percent|{"percent":66}',
    );
  });

  it('shows only the settled word when nothing was attempted', () => {
    const { container } = render(
      <ProposalProgressLabel
        view={createView('settled', { applied: 0, attempted: 0 })}
      />,
    );
    expect(container.textContent).toBe('change_proposal.lifecycle.settled');
  });

  it('shows only the settled word for a revert proposal without achievement', () => {
    const { container } = render(
      <ProposalProgressLabel view={createView('settled')} />,
    );
    expect(container.textContent).toBe('change_proposal.lifecycle.settled');
  });

  it.each([
    ['discarded', 'change_proposal.lifecycle.discarded'],
    ['expired', 'change_proposal.lifecycle.expired'],
    ['withdrawn', 'change_proposal.lifecycle.withdrawn'],
  ] as const)('shows the lifecycle word for %s', (lifecycle, key) => {
    const { container } = render(
      <ProposalProgressLabel view={createView(lifecycle)} />,
    );
    expect(container.textContent).toBe(key);
  });

  it('shows nothing while the proposal is still open', () => {
    const { container } = render(
      <ProposalProgressLabel view={createView('open')} />,
    );
    expect(container.textContent).toBe('');
  });

  it('shows nothing when core returned no requester state', () => {
    const { container } = render(<ProposalProgressLabel view={{}} />);
    expect(container.textContent).toBe('');
  });
});
