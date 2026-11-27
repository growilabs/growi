// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import type { ChangeProposalView } from '../../../../interfaces';
import { PerPageNotificationsLabel } from './PerPageNotificationsLabel';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const createView = (perPageNotifications: {
  value: boolean;
  isEnabledBySettings: boolean;
}): Pick<ChangeProposalView, 'requesterState'> => ({
  requesterState: { lifecycle: 'open', perPageNotifications },
});

describe('PerPageNotificationsLabel', () => {
  it('shows the enabled wording as text only', () => {
    const { container } = render(
      <PerPageNotificationsLabel
        view={createView({ value: true, isEnabledBySettings: true })}
      />,
    );
    expect(container.textContent).toBe(
      'change_proposal_viewer.per_page_notifications.enabled',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows the disabled wording when the value is off', () => {
    const { container } = render(
      <PerPageNotificationsLabel
        view={createView({ value: false, isEnabledBySettings: true })}
      />,
    );
    expect(container.textContent).toBe(
      'change_proposal_viewer.per_page_notifications.disabled',
    );
  });

  it('shows nothing when the admin setting is off', () => {
    const { container } = render(
      <PerPageNotificationsLabel
        view={createView({ value: true, isEnabledBySettings: false })}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('shows nothing for a non-requester', () => {
    const { container } = render(<PerPageNotificationsLabel view={{}} />);
    expect(container.textContent).toBe('');
  });
});
