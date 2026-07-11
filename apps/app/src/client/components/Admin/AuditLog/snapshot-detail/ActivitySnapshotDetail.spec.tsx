// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import prettyBytes from 'pretty-bytes';

import type { IActivityHasId } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';

import { ActivitySnapshotDetail } from './ActivitySnapshotDetail';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see RawSnapshotDetail.spec.tsx), so assertions target the key itself.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// next/link reaches for the Pages-Router context (prefetch); render a plain
// anchor so PagePathHierarchicalLink is queryable without a router provider
// (established convention; see AttachmentRemoveSnapshotDetail.spec.tsx).
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const buildActivity = (overrides: Partial<IActivityHasId>): IActivityHasId => ({
  _id: 'activity-id-1',
  action: SupportedAction.ACTION_PAGE_CREATE,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

// NOTE on DOM-presence assertions: only the active tab's content is mounted
// (the inactive pane is unmounted on switch), so "present in the DOM" is
// equivalent to "shown on the active tab" here
// (happy-dom applies no Bootstrap CSS, so visibility cannot be asserted).

describe('ActivitySnapshotDetail', () => {
  describe('when the action has a registered formatted renderer (ATTACHMENT_REMOVE)', () => {
    const activity = buildActivity({
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      snapshot: {
        username: 'alice',
        originalName: 'photo.png',
        fileSize: 123456,
        pagePath: '/reports',
        pageId: 'page-id-1',
      },
    });

    it('shows the formatted view by default, with tab controls reachable by role', () => {
      render(<ActivitySnapshotDetail activity={activity} />);

      // Formatted content is the default view
      expect(
        screen.getByText('admin:audit_log_snapshot.file_name'),
      ).toBeInTheDocument();
      expect(screen.getByText('photo.png')).toBeInTheDocument();
      expect(screen.getByText(prettyBytes(123456))).toBeInTheDocument();

      // Raw-only content (pageId has no formatted field) is not shown yet
      expect(screen.queryByText('pageId')).not.toBeInTheDocument();

      // Both tabs are reachable by role, and Formatted is the selected one
      expect(screen.getByRole('tab', { name: 'Formatted' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('tab', { name: 'Raw' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });

    it('reveals every snapshot field as key-value on the raw tab — formatting augments raw, it never replaces it', async () => {
      const user = userEvent.setup();
      render(<ActivitySnapshotDetail activity={activity} />);

      await user.click(screen.getByRole('tab', { name: 'Raw' }));

      // ALL snapshot fields, including those the formatted view does not show
      expect(screen.getByText('username')).toBeInTheDocument();
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('originalName')).toBeInTheDocument();
      expect(screen.getByText('photo.png')).toBeInTheDocument();
      expect(screen.getByText('pagePath')).toBeInTheDocument();
      expect(screen.getByText('/reports')).toBeInTheDocument();
      expect(screen.getByText('pageId')).toBeInTheDocument();
      expect(screen.getByText('page-id-1')).toBeInTheDocument();
      expect(screen.getByText('fileSize')).toBeInTheDocument();
      expect(screen.getByText('123456')).toBeInTheDocument();

      // Switching back restores the formatted view (local tab state, two-way)
      await user.click(screen.getByRole('tab', { name: 'Formatted' }));
      expect(
        screen.getByText('admin:audit_log_snapshot.file_name'),
      ).toBeInTheDocument();
    });

    it('does not throw when the snapshot is missing; the raw tab shows the no-detail placeholder', async () => {
      const user = userEvent.setup();
      const withoutSnapshot = buildActivity({
        action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
        snapshot: undefined,
      });

      expect(() =>
        render(<ActivitySnapshotDetail activity={withoutSnapshot} />),
      ).not.toThrow();

      await user.click(screen.getByRole('tab', { name: 'Raw' }));
      expect(
        screen.getByText('admin:audit_log_snapshot.no_detail'),
      ).toBeInTheDocument();
    });
  });

  describe('when the action has no registered formatted renderer', () => {
    it('renders the raw key-value view without any tab chrome', () => {
      const activity = buildActivity({
        action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
        snapshot: { username: 'bob' },
      });

      render(<ActivitySnapshotDetail activity={activity} />);

      expect(screen.getByText('username')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();

      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('shows raw only — no formatted labels, no tabs — for a legacy username-only snapshot', () => {
      const activity = buildActivity({
        action: SupportedAction.ACTION_PAGE_CREATE,
        snapshot: { username: 'legacy-user' },
      });

      render(<ActivitySnapshotDetail activity={activity} />);

      expect(screen.getByText('username')).toBeInTheDocument();
      expect(screen.getByText('legacy-user')).toBeInTheDocument();

      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(
        screen.queryByText('admin:audit_log_snapshot.file_name'),
      ).not.toBeInTheDocument();
    });
  });
});
