// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import { RawSnapshotDetail } from './RawSnapshotDetail';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see IncompleteResponseNotice.spec.tsx), so assertions target the key
// itself rather than the translated text, which lives in the locale JSON.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('RawSnapshotDetail', () => {
  it('renders every snapshot field as a key-value pair, including the passthrough _id', () => {
    const snapshot = {
      _id: 'snap-id-1',
      username: 'alice',
      originalName: 'photo.png',
      fileSize: 12345,
      pagePath: '/foo/bar',
    };

    render(<RawSnapshotDetail snapshot={snapshot} />);

    expect(screen.getByText('_id')).toBeInTheDocument();
    expect(screen.getByText('snap-id-1')).toBeInTheDocument();
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('originalName')).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('fileSize')).toBeInTheDocument();
    expect(screen.getByText('12345')).toBeInTheDocument();
    expect(screen.getByText('pagePath')).toBeInTheDocument();
    expect(screen.getByText('/foo/bar')).toBeInTheDocument();
  });

  it.each([
    ['an undefined snapshot', undefined],
    ['an empty-object snapshot', {}],
  ])('shows the no-detail placeholder and does not throw for %s', (_label, snapshot) => {
    expect(() =>
      render(<RawSnapshotDetail snapshot={snapshot} />),
    ).not.toThrow();

    expect(
      screen.getByText('admin:audit_log_snapshot.no_detail'),
    ).toBeInTheDocument();
  });
});
