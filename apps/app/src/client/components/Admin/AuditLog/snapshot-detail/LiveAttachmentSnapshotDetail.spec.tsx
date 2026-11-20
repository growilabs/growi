// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import prettyBytes from 'pretty-bytes';

import type { AttachmentSnapshot, IActivityHasId } from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';

import { LiveAttachmentSnapshotDetail } from './LiveAttachmentSnapshotDetail';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see AttachmentRemoveSnapshotDetail.spec.tsx), so assertions target the
// key itself.
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

type ActivityWithAttachmentSnapshot = IActivityHasId & {
  snapshot?: AttachmentSnapshot;
};

const buildActivity = (
  overrides: Partial<ActivityWithAttachmentSnapshot> = {},
): ActivityWithAttachmentSnapshot => ({
  _id: 'activity-id-1',
  action: SupportedAction.ACTION_ATTACHMENT_ADD,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  target: 'attachment-id-1',
  snapshot: {
    originalName: 'photo.png',
    fileSize: 123456,
    pagePath: '/reports',
  },
  ...overrides,
});

const getDownloadLink = (): HTMLAnchorElement | null =>
  screen.queryByRole('link', {
    name: 'admin:audit_log_snapshot.download',
  }) as HTMLAnchorElement | null;

describe('LiveAttachmentSnapshotDetail', () => {
  it('renders the file name, human-readable size, a page link, and a download link to /download/{target} when every field and the target are present', () => {
    const activity = buildActivity();

    render(<LiveAttachmentSnapshotDetail activity={activity} />);

    // Shared fields
    expect(
      screen.getByText('admin:audit_log_snapshot.file_name'),
    ).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText(prettyBytes(123456))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'reports' })).toHaveAttribute(
      'href',
      '/reports',
    );

    // Download link built from the activity's target (the attachment id)
    const downloadLink = getDownloadLink();
    expect(downloadLink).toHaveAttribute('href', '/download/attachment-id-1');
  });

  it('does not render a download link when the target is absent, while the other fields still render', () => {
    const activity = buildActivity({ target: undefined });

    render(<LiveAttachmentSnapshotDetail activity={activity} />);

    // No download link
    expect(getDownloadLink()).not.toBeInTheDocument();
    // No anchor points at a download path at all
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toMatch(/\/download\//);
    }

    // Other fields still render
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText(prettyBytes(123456))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'reports' })).toBeInTheDocument();
  });

  it('falls back per field when originalName / pagePath / fileSize are missing, still showing the download link when target is present', () => {
    const activity = buildActivity({ snapshot: {} });

    expect(() =>
      render(<LiveAttachmentSnapshotDetail activity={activity} />),
    ).not.toThrow();

    expect(
      screen.getByText('admin:audit_log_snapshot.unknown_file_name'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('admin:audit_log_snapshot.unknown_size'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('admin:audit_log_snapshot.page_unavailable'),
    ).toBeInTheDocument();

    // The download link depends on target, not on the snapshot fields
    expect(getDownloadLink()).toHaveAttribute(
      'href',
      '/download/attachment-id-1',
    );
  });

  it('treats a fileSize of 0 bytes as present, not missing', () => {
    const activity = buildActivity({
      snapshot: {
        originalName: 'empty.txt',
        fileSize: 0,
        pagePath: '/reports',
      },
    });

    render(<LiveAttachmentSnapshotDetail activity={activity} />);

    expect(screen.getByText(prettyBytes(0))).toBeInTheDocument();
    expect(
      screen.queryByText('admin:audit_log_snapshot.unknown_size'),
    ).not.toBeInTheDocument();
  });
});
