// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import prettyBytes from 'pretty-bytes';

import type {
  AttachmentRemoveSnapshot,
  IActivityHasId,
} from '~/interfaces/activity';
import { SupportedAction } from '~/interfaces/activity';

import { AttachmentRemoveSnapshotDetail } from './AttachmentRemoveSnapshotDetail';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see RawSnapshotDetail.spec.tsx), so assertions target the key itself.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// next/link reaches for the Pages-Router context (prefetch); render a plain
// anchor so PagePathHierarchicalLink is queryable without a router provider
// (established convention; see PageSources.spec.tsx).
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

type ActivityWithAttachmentRemoveSnapshot = IActivityHasId & {
  snapshot?: AttachmentRemoveSnapshot;
};

const buildActivity = (
  snapshot?: AttachmentRemoveSnapshot,
): ActivityWithAttachmentRemoveSnapshot => ({
  _id: 'activity-id-1',
  action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  snapshot,
});

describe('AttachmentRemoveSnapshotDetail', () => {
  it('renders the file name, human-readable size, and a page link, but no download link, when every field is present', () => {
    const activity = buildActivity({
      originalName: 'photo.png',
      fileSize: 123456,
      pagePath: '/reports',
    });

    render(<AttachmentRemoveSnapshotDetail activity={activity} />);

    // Field labels
    expect(
      screen.getByText('admin:audit_log_snapshot.file_name'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('admin:audit_log_snapshot.file_size'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('admin:audit_log_snapshot.page'),
    ).toBeInTheDocument();

    // Field values
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText(prettyBytes(123456))).toBeInTheDocument();

    const pageLink = screen.getByRole('link', { name: 'reports' });
    expect(pageLink).toHaveAttribute('href', '/reports');

    // Deleted entity: never a download link, whatever else is on the page
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toMatch(/download/i);
    }
  });

  it('treats a fileSize of 0 bytes as present, not missing', () => {
    const activity = buildActivity({
      originalName: 'empty.txt',
      fileSize: 0,
      pagePath: '/reports',
    });

    render(<AttachmentRemoveSnapshotDetail activity={activity} />);

    expect(screen.getByText(prettyBytes(0))).toBeInTheDocument();
    expect(
      screen.queryByText('admin:audit_log_snapshot.unknown_size'),
    ).not.toBeInTheDocument();
  });

  it('falls back to the unknown-file-name label when originalName is missing, without stopping the other fields from rendering', () => {
    const activity = buildActivity({
      fileSize: 123456,
      pagePath: '/reports',
    });

    expect(() =>
      render(<AttachmentRemoveSnapshotDetail activity={activity} />),
    ).not.toThrow();

    expect(
      screen.getByText('admin:audit_log_snapshot.unknown_file_name'),
    ).toBeInTheDocument();
    // Other fields still render
    expect(screen.getByText(prettyBytes(123456))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'reports' })).toBeInTheDocument();
  });

  it('shows no page link and a page-unavailable label when pagePath is missing, without stopping the other fields from rendering', () => {
    const activity = buildActivity({
      originalName: 'photo.png',
      fileSize: 123456,
    });

    expect(() =>
      render(<AttachmentRemoveSnapshotDetail activity={activity} />),
    ).not.toThrow();

    expect(
      screen.getByText('admin:audit_log_snapshot.page_unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    // Other fields still render
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText(prettyBytes(123456))).toBeInTheDocument();
  });

  it('falls back to the unknown-size label when fileSize is missing, without stopping the other fields from rendering', () => {
    const activity = buildActivity({
      originalName: 'photo.png',
      pagePath: '/reports',
    });

    expect(() =>
      render(<AttachmentRemoveSnapshotDetail activity={activity} />),
    ).not.toThrow();

    expect(
      screen.getByText('admin:audit_log_snapshot.unknown_size'),
    ).toBeInTheDocument();
    // Other fields still render
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'reports' })).toBeInTheDocument();
  });
});
