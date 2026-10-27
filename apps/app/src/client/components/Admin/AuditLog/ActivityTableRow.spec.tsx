// @vitest-environment happy-dom

import type { IUserHasId } from '@growi/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mock } from 'vitest-mock-extended';

import type { IActivityHasId } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';

import { ActivityTableRow } from './ActivityTableRow';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see snapshot-detail/ActivitySnapshotDetail.spec.tsx), so assertions
// target the key itself.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// UserPicture renders an avatar/tooltip that is unrelated to this row's
// contract; stub it to a lightweight marker (established convention; see
// PageEditor/EditorNavbar/EditingUserList.spec.tsx).
vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

// This spec's contract is "the row mounts/unmounts ActivitySnapshotDetail
// based on its own expand state" — the detail component's actual rendering
// (raw/formatted/tabs) is already covered by
// snapshot-detail/ActivitySnapshotDetail.spec.tsx. Stubbing it here keeps
// this file a unit test of the row/disclosure behavior only, and proves
// which activity was forwarded via the stub's own output.
vi.mock('./snapshot-detail', () => ({
  ActivitySnapshotDetail: ({ activity }: { activity: IActivityHasId }) => (
    <div data-testid="mock-activity-snapshot-detail">{activity.action}</div>
  ),
}));

const buildActivity = (
  overrides: Partial<IActivityHasId> = {},
): IActivityHasId => ({
  _id: 'activity-id-1',
  action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
  createdAt: new Date('2026-01-01T09:30:00.000Z'),
  ip: '127.0.0.1',
  endpoint: '/api/v3/login',
  user: mock<IUserHasId>({ _id: 'user-id-1', username: 'alice' }),
  snapshot: { username: 'alice' },
  ...overrides,
});

// A bare <tr> is not valid outside a <table>/<tbody> parent; wrap it the way
// the real ActivityTable does (established convention per task boundary).
const renderRow = (activity: IActivityHasId) =>
  render(
    <table>
      <tbody>
        <ActivityTableRow activity={activity} />
      </tbody>
    </table>,
  );

describe('ActivityTableRow', () => {
  describe('existing 5 cells (user/date/action/ip/url)', () => {
    it('renders username, formatted date, action i18n key, ip, and endpoint exactly as the current table does', () => {
      const activity = buildActivity();
      renderRow(activity);

      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('2026/01/01 09:30:00')).toBeInTheDocument();
      expect(
        screen.getByText(
          `admin:audit_log_action.${SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL}`,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('127.0.0.1')).toBeInTheDocument();
      expect(screen.getByText('/api/v3/login')).toBeInTheDocument();
    });

    it('keeps the existing data-testid="activity-table" on the main row', () => {
      renderRow(buildActivity());
      expect(screen.getByTestId('activity-table')).toBeInTheDocument();
    });
  });

  describe('disclosure toggle', () => {
    it('has aria-expanded="false" initially, and does not mount the snapshot detail', () => {
      renderRow(buildActivity());

      expect(
        screen.getByRole('button', { name: /toggle snapshot detail/i }),
      ).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByTestId('activity-snapshot-detail'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mock-activity-snapshot-detail'),
      ).not.toBeInTheDocument();
    });

    it('reveals the detail sub-row on click (aria-expanded flips to true) and removes it again on a second click (unmounted, not just hidden)', async () => {
      const user = userEvent.setup();
      const activity = buildActivity({
        action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      });
      renderRow(activity);

      const toggle = screen.getByRole('button', {
        name: /toggle snapshot detail/i,
      });

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const detailRow = screen.getByTestId('activity-snapshot-detail');
      expect(detailRow).toBeInTheDocument();
      // The forwarded activity is the one this row owns (proves wiring, not
      // just that *some* detail row appeared).
      expect(
        screen.getByTestId('mock-activity-snapshot-detail'),
      ).toHaveTextContent(SupportedAction.ACTION_ATTACHMENT_REMOVE);

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByTestId('activity-snapshot-detail'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('mock-activity-snapshot-detail'),
      ).not.toBeInTheDocument();
    });
  });
});
