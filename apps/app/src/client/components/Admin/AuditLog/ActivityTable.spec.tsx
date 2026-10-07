// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import type { IUserHasId } from '@growi/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import prettyBytes from 'pretty-bytes';
import { mock } from 'vitest-mock-extended';

import type { IActivityHasId } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';

import { ActivityTable } from './ActivityTable';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see snapshot-detail/ActivitySnapshotDetail.spec.tsx), so assertions
// target the key itself.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// next/link reaches for the Pages-Router context (prefetch); render a plain
// anchor so PagePathHierarchicalLink (used by the ATTACHMENT_REMOVE formatted
// renderer) is queryable without a router provider (established convention;
// see snapshot-detail/AttachmentRemoveSnapshotDetail.spec.tsx).
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

// UserPicture reaches for next/router (via UserPictureRootWithLink), which is
// unrelated to this feature-level test's contract; stub it to a lightweight
// marker (established convention; see ActivityTableRow.spec.tsx).
vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: () => <span data-testid="user-picture" />,
}));

// This is a FEATURE-LEVEL integration test: ActivityTableRow,
// ActivitySnapshotDetail, the renderer registry, and the individual renderers
// are all the REAL implementations (unlike ActivityTableRow.spec.tsx, which
// stubs ActivitySnapshotDetail to isolate the row's own disclosure behavior).
// The goal here is to prove the whole stack renders a mixed legacy/new
// activityList without breaking (Requirement 5.3).

const buildActivity = (
  overrides: Partial<IActivityHasId> = {},
): IActivityHasId => ({
  _id: 'activity-id-default',
  action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
  createdAt: new Date('2026-01-01T09:30:00.000Z'),
  ip: '127.0.0.1',
  endpoint: '/api/v3/login',
  user: mock<IUserHasId>({ _id: 'user-id-default', username: 'default-user' }),
  snapshot: { username: 'default-user' },
  ...overrides,
});

// Legacy record A: snapshot has only `username` (the pre-attachment-snapshot
// shape), and a non-attachment action with no registered formatted renderer.
const legacyUsernameOnlyActivity = buildActivity({
  _id: 'activity-id-legacy-a',
  action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
  ip: '10.0.0.1',
  endpoint: '/legacy-a',
  user: mock<IUserHasId>({ _id: 'user-id-a', username: 'legacy-user-a' }),
  snapshot: { username: 'legacy-user-a' },
});

// Legacy record B: no snapshot at all (older activity predating snapshot
// capture entirely).
const legacyNoSnapshotActivity = buildActivity({
  _id: 'activity-id-legacy-b',
  action: SupportedAction.ACTION_USER_LOGOUT,
  ip: '10.0.0.2',
  endpoint: '/legacy-b',
  user: mock<IUserHasId>({ _id: 'user-id-b', username: 'legacy-user-b' }),
  snapshot: undefined,
});

// New record: ATTACHMENT_REMOVE with a full attachment snapshot.
const attachmentRemoveActivity = buildActivity({
  _id: 'activity-id-new-c',
  action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
  ip: '10.0.0.3',
  endpoint: '/attachment-remove',
  user: mock<IUserHasId>({ _id: 'user-id-c', username: 'carol' }),
  snapshot: {
    username: 'carol',
    originalName: 'photo.png',
    pagePath: '/reports',
    pageId: 'page-id-1',
    fileSize: 123456,
  },
});

// New record: ATTACHMENT_ADD with a full attachment snapshot. The file still
// exists, so `target` (the attachment id) drives a download link.
const attachmentAddActivity = buildActivity({
  _id: 'activity-id-new-d',
  action: SupportedAction.ACTION_ATTACHMENT_ADD,
  ip: '10.0.0.4',
  endpoint: '/attachment-add',
  target: 'attachment-id-add',
  user: mock<IUserHasId>({ _id: 'user-id-d', username: 'dave' }),
  snapshot: {
    username: 'dave',
    originalName: 'diagram.png',
    pagePath: '/design',
    pageId: 'page-id-2',
    fileSize: 2048,
  },
});

// New record: ATTACHMENT_DOWNLOAD with a full attachment snapshot. Shares the
// live-attachment renderer with ADD (same shape, file still exists).
const attachmentDownloadActivity = buildActivity({
  _id: 'activity-id-new-e',
  action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
  ip: '10.0.0.5',
  endpoint: '/attachment-download',
  target: 'attachment-id-dl',
  user: mock<IUserHasId>({ _id: 'user-id-e', username: 'erin' }),
  snapshot: {
    username: 'erin',
    originalName: 'manual.pdf',
    pagePath: '/docs',
    pageId: 'page-id-3',
    fileSize: 4096,
  },
});

// Backward-compat record: an ATTACHMENT_ADD recorded before the attachment
// snapshot capture existed — its snapshot has only `username` (no attachment
// fields), but the activity still carries `target` (a core activity field that
// predates the snapshot increment). The live renderer must fall back per field
// yet still offer the download link (Requirement 8.1).
const legacyAttachmentAddActivity = buildActivity({
  _id: 'activity-id-legacy-add',
  action: SupportedAction.ACTION_ATTACHMENT_ADD,
  ip: '10.0.0.6',
  endpoint: '/attachment-add-legacy',
  target: 'attachment-id-legacy-add',
  user: mock<IUserHasId>({ _id: 'user-id-f', username: 'frank' }),
  snapshot: { username: 'frank' },
});

const mixedActivityList: IActivityHasId[] = [
  legacyUsernameOnlyActivity,
  legacyNoSnapshotActivity,
  attachmentRemoveActivity,
  attachmentAddActivity,
  attachmentDownloadActivity,
  legacyAttachmentAddActivity,
];

// Each fixture's `ip` is unique, so it identifies the fixture's own <tr> even
// though the disclosure button's accessible name ("Toggle snapshot detail")
// is identical across every row.
const getMainRowByIp = (ip: string): HTMLElement => {
  const row = screen.getByText(ip).closest('tr');
  if (row == null) {
    throw new Error(`main row for ip "${ip}" not found`);
  }
  return row;
};

const expandRowByIp = async (
  user: ReturnType<typeof userEvent.setup>,
  ip: string,
) => {
  const toggle = within(getMainRowByIp(ip)).getByRole('button', {
    name: /toggle snapshot detail/i,
  });
  await user.click(toggle);
};

describe('ActivityTable (feature-level, mixed legacy/new records)', () => {
  it('renders every row without throwing, keeping the existing user/action display for legacy rows (Requirements 1.2, 5.1, 5.3)', () => {
    expect(() =>
      render(<ActivityTable activityList={mixedActivityList} />),
    ).not.toThrow();

    // One main row per activity
    expect(screen.getAllByTestId('activity-table')).toHaveLength(6);

    // Legacy record A: username-only snapshot renders the username as before
    expect(screen.getByText('legacy-user-a')).toBeInTheDocument();
    expect(
      screen.getByText(
        `admin:audit_log_action.${SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL}`,
      ),
    ).toBeInTheDocument();

    // Legacy record B: no snapshot at all, still renders its action/ip cells
    expect(screen.getByText('10.0.0.2')).toBeInTheDocument();
    expect(
      screen.getByText(
        `admin:audit_log_action.${SupportedAction.ACTION_USER_LOGOUT}`,
      ),
    ).toBeInTheDocument();

    // New record: attachment snapshot's username still renders in the user cell
    expect(screen.getByText('carol')).toBeInTheDocument();
    expect(
      screen.getByText(
        `admin:audit_log_action.${SupportedAction.ACTION_ATTACHMENT_REMOVE}`,
      ),
    ).toBeInTheDocument();
  });

  it('expanding the ATTACHMENT_REMOVE row shows the formatted view by default with reachable tab controls, and the raw tab reveals every field (including pageId) with no download link (Requirements 1.5, 2.1-2.4)', async () => {
    const user = userEvent.setup();
    render(<ActivityTable activityList={mixedActivityList} />);

    await expandRowByIp(user, '10.0.0.3');

    const detailRow = screen.getByTestId('activity-snapshot-detail');

    // Formatted view is the default
    expect(
      within(detailRow).getByText('admin:audit_log_snapshot.file_name'),
    ).toBeInTheDocument();
    expect(within(detailRow).getByText('photo.png')).toBeInTheDocument();
    expect(
      within(detailRow).getByText(prettyBytes(123456)),
    ).toBeInTheDocument();
    expect(
      within(detailRow).getByRole('link', { name: 'reports' }),
    ).toHaveAttribute('href', '/reports');

    // pageId has no formatted field, so it is not shown on the formatted tab
    expect(within(detailRow).queryByText('pageId')).not.toBeInTheDocument();

    // Tabs are reachable by role, Info is selected
    expect(
      within(detailRow).getByRole('tab', { name: 'Info' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(within(detailRow).getByRole('tab', { name: 'Raw' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    // A removed attachment never shows a download link, on either tab
    for (const anchor of detailRow.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toMatch(/download/i);
    }

    // Switching to raw reveals ALL snapshot fields as key-value, including
    // pageId (which the formatted view above does not show) — formatting
    // augments raw, it never replaces it.
    await user.click(within(detailRow).getByRole('tab', { name: 'Raw' }));

    expect(within(detailRow).getByText('pageId')).toBeInTheDocument();
    expect(within(detailRow).getByText('page-id-1')).toBeInTheDocument();
    expect(within(detailRow).getByText('originalName')).toBeInTheDocument();
    expect(within(detailRow).getByText('photo.png')).toBeInTheDocument();
    expect(within(detailRow).getByText('pagePath')).toBeInTheDocument();
    expect(within(detailRow).getByText('/reports')).toBeInTheDocument();
    expect(within(detailRow).getByText('fileSize')).toBeInTheDocument();
    expect(within(detailRow).getByText('123456')).toBeInTheDocument();
    expect(within(detailRow).getByText('username')).toBeInTheDocument();
    expect(within(detailRow).getByText('carol')).toBeInTheDocument();

    // Still no download link once the raw tab is active
    for (const anchor of detailRow.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toMatch(/download/i);
    }
  });

  it('expanding the ATTACHMENT_ADD row shows the formatted view with a download link to /download/{target}, and the raw tab still reveals every field (Requirements 6.1, 6.2, 7.1)', async () => {
    const user = userEvent.setup();
    render(<ActivityTable activityList={mixedActivityList} />);

    await expandRowByIp(user, '10.0.0.4');

    const detailRow = screen.getByTestId('activity-snapshot-detail');

    // Formatted view is the default
    expect(
      within(detailRow).getByText('admin:audit_log_snapshot.file_name'),
    ).toBeInTheDocument();
    expect(within(detailRow).getByText('diagram.png')).toBeInTheDocument();
    expect(within(detailRow).getByText(prettyBytes(2048))).toBeInTheDocument();
    expect(
      within(detailRow).getByRole('link', { name: 'design' }),
    ).toHaveAttribute('href', '/design');

    // A still-existing attachment shows a download link built from `target`
    expect(
      within(detailRow).getByRole('link', {
        name: 'admin:audit_log_snapshot.download',
      }),
    ).toHaveAttribute('href', '/download/attachment-id-add');

    // Info is selected, Raw is reachable
    expect(
      within(detailRow).getByRole('tab', { name: 'Info' }),
    ).toHaveAttribute('aria-selected', 'true');

    // Raw tab reveals all fields, including pageId (formatting augments raw)
    await user.click(within(detailRow).getByRole('tab', { name: 'Raw' }));
    expect(within(detailRow).getByText('pageId')).toBeInTheDocument();
    expect(within(detailRow).getByText('page-id-2')).toBeInTheDocument();
  });

  it('expanding the ATTACHMENT_DOWNLOAD row shows the same formatted view with a download link (shared renderer with ADD) (Requirements 6.1, 7.1)', async () => {
    const user = userEvent.setup();
    render(<ActivityTable activityList={mixedActivityList} />);

    await expandRowByIp(user, '10.0.0.5');

    const detailRow = screen.getByTestId('activity-snapshot-detail');

    expect(within(detailRow).getByText('manual.pdf')).toBeInTheDocument();
    expect(within(detailRow).getByText(prettyBytes(4096))).toBeInTheDocument();
    expect(
      within(detailRow).getByRole('link', { name: 'docs' }),
    ).toHaveAttribute('href', '/docs');
    expect(
      within(detailRow).getByRole('link', {
        name: 'admin:audit_log_snapshot.download',
      }),
    ).toHaveAttribute('href', '/download/attachment-id-dl');
  });

  it('expanding a legacy ATTACHMENT_ADD row (no attachment fields) falls back per field yet still shows the download link from target (Requirements 8.1, 7.1)', async () => {
    const user = userEvent.setup();
    render(<ActivityTable activityList={mixedActivityList} />);

    await expandRowByIp(user, '10.0.0.6');

    const detailRow = screen.getByTestId('activity-snapshot-detail');

    // Attachment fields are missing → per-field fallbacks, no throw
    expect(
      within(detailRow).getByText('admin:audit_log_snapshot.unknown_file_name'),
    ).toBeInTheDocument();
    expect(
      within(detailRow).getByText('admin:audit_log_snapshot.unknown_size'),
    ).toBeInTheDocument();
    expect(
      within(detailRow).getByText('admin:audit_log_snapshot.page_unavailable'),
    ).toBeInTheDocument();

    // The download link still appears because `target` is present
    expect(
      within(detailRow).getByRole('link', {
        name: 'admin:audit_log_snapshot.download',
      }),
    ).toHaveAttribute('href', '/download/attachment-id-legacy-add');
  });

  it('expanding a legacy username-only row shows raw only (no tab chrome), with the username field visible as key-value (Requirements 1.2, 5.1)', async () => {
    const user = userEvent.setup();
    render(<ActivityTable activityList={mixedActivityList} />);

    await expandRowByIp(user, '10.0.0.1');

    const detailRow = screen.getByTestId('activity-snapshot-detail');

    expect(within(detailRow).getByText('username')).toBeInTheDocument();
    expect(within(detailRow).getByText('legacy-user-a')).toBeInTheDocument();

    // No tab chrome for an action with no registered formatted renderer
    expect(within(detailRow).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(detailRow).queryByRole('tablist')).not.toBeInTheDocument();
    expect(
      within(detailRow).queryByText('admin:audit_log_snapshot.file_name'),
    ).not.toBeInTheDocument();
  });

  it('expanding a legacy record with no snapshot at all shows the no-detail placeholder and does not throw (Requirements 1.3, 3.4, 5.1)', async () => {
    const user = userEvent.setup();

    expect(() =>
      render(<ActivityTable activityList={mixedActivityList} />),
    ).not.toThrow();

    await expandRowByIp(user, '10.0.0.2');

    const detailRow = screen.getByTestId('activity-snapshot-detail');

    expect(
      within(detailRow).getByText('admin:audit_log_snapshot.no_detail'),
    ).toBeInTheDocument();
    expect(within(detailRow).queryByRole('tab')).not.toBeInTheDocument();
  });
});
