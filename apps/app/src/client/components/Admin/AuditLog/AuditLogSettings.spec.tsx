import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

import { AuditLogSettings } from './AuditLogSettings';

// `t` returns the i18n key verbatim (established convention for admin AuditLog
// specs; see ActivityTable.spec.tsx), so assertions target the key itself.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// next/link reaches for the Pages-Router context (prefetch); render a plain
// anchor so the "Go to Elasticsearch management" link is queryable without a
// router provider (established convention; see ActivityTable.spec.tsx).
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

describe('AuditLogSettings', () => {
  it('links the available-action-list help icon to the log-type docs and opens it in a safe new tab', () => {
    render(<AuditLogSettings />);

    const helpLink = screen
      .getAllByRole('link', { name: 'Help' })
      .find(
        (link) =>
          link.getAttribute('href') ===
          'admin:audit_log_management.docs_url.log_type',
      );

    expect(helpLink).toBeDefined();
    expect(helpLink).toHaveAttribute('target', '_blank');
    expect(helpLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('links the audit-log-index-management help icon to the setup-search-system docs and opens it in a safe new tab', () => {
    render(<AuditLogSettings />);

    const helpLink = screen
      .getAllByRole('link', { name: 'Help' })
      .find(
        (link) =>
          link.getAttribute('href') ===
          'admin:audit_log_index_management.docs_url.top',
      );

    expect(helpLink).toBeDefined();
    expect(helpLink).toHaveAttribute('target', '_blank');
    expect(helpLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
