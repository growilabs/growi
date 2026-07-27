import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

import { CopyDropdown } from './CopyDropdown';

/**
 * Requirements covered: 7.1, 7.2, 7.3, 7.4 (page-markdown-endpoint spec).
 *
 * next-i18next: reduce t() to identity so the assertion targets the i18n key
 * itself (matches the convention used elsewhere in this app, e.g. GrantSelector.spec.tsx).
 */
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * react-copy-to-clipboard wraps its child and copies the `text` prop on click.
 * We surface `text` as a DOM attribute so tests can assert the exact payload
 * that would be copied without invoking the real browser clipboard API.
 */
vi.mock('react-copy-to-clipboard', () => ({
  CopyToClipboard: ({
    text,
    children,
  }: {
    text: string;
    onCopy?: () => void;
    children: ReactNode;
  }) => <div data-copy-text={text}>{children}</div>,
}));

/**
 * reactstrap's real Dropdown/DropdownMenu compose react-popper for positioning,
 * which is irrelevant to this component's contract (which items it renders,
 * and with what content) and adds open/close-state noise unrelated to
 * Requirements 7.1-7.4. Reduce to pass-through elements.
 */
vi.mock('reactstrap', () => ({
  Dropdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownToggle: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownItem: ({
    children,
    header,
    divider,
  }: {
    children?: ReactNode;
    header?: boolean;
    divider?: boolean;
  }) => {
    if (divider) {
      return null;
    }
    return <div>{children}</div>;
  },
  Tooltip: () => null,
}));

const MARKDOWN_URL_LABEL = 'copy_to_clipboard.Markdown URL';

describe('CopyDropdown', () => {
  describe('Requirement 7.1 - normal page shows the "Markdown URL" item', () => {
    it('renders the "Markdown URL" item', () => {
      render(
        <CopyDropdown dropdownToggleId="test-toggle" pagePath="/foo/bar">
          toggle
        </CopyDropdown>,
      );

      expect(screen.getByText(MARKDOWN_URL_LABEL)).toBeInTheDocument();
    });
  });

  describe('Requirement 7.2 - selecting the item copies "{path}.md"', () => {
    it('copies the page path URL with ".md" appended', () => {
      render(
        <CopyDropdown dropdownToggleId="test-toggle" pagePath="/foo/bar">
          toggle
        </CopyDropdown>,
      );

      const label = screen.getByText(MARKDOWN_URL_LABEL);
      const copyWrapper = label.closest('[data-copy-text]');

      expect(copyWrapper).not.toBeNull();
      expect(copyWrapper).toHaveAttribute(
        'data-copy-text',
        `${window.location.origin}/foo/bar.md`,
      );
    });
  });

  describe('Requirement 7.3 - a path already ending in ".md" gets ".md" appended unconditionally', () => {
    it('produces "{path}.md.md" rather than deduplicating the suffix', () => {
      render(
        <CopyDropdown dropdownToggleId="test-toggle" pagePath="/README.md">
          toggle
        </CopyDropdown>,
      );

      const label = screen.getByText(MARKDOWN_URL_LABEL);
      const copyWrapper = label.closest('[data-copy-text]');

      expect(copyWrapper).toHaveAttribute(
        'data-copy-text',
        `${window.location.origin}/README.md.md`,
      );
    });
  });

  describe('Requirement 7.4 - share-link display mode hides the item', () => {
    it('does not render the "Markdown URL" item', () => {
      render(
        <CopyDropdown
          dropdownToggleId="test-toggle"
          pagePath="/foo/bar"
          isShareLinkMode
        >
          toggle
        </CopyDropdown>,
      );

      expect(screen.queryByText(MARKDOWN_URL_LABEL)).not.toBeInTheDocument();
    });
  });
});
