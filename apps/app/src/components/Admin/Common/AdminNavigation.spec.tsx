// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

vi.mock('~/states/global', () => ({
  useGrowiCloudUri: () => undefined,
  useGrowiAppIdForGrowiCloud: () => undefined,
}));

import { AdminNavigation } from './AdminNavigation';

describe('AdminNavigation', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders a navigation link to the AI settings page (/admin/ai)', () => {
    // Act
    render(<AdminNavigation />);

    // Assert: at least one link points to the AI settings admin page.
    // Both the desktop list-group and the mobile dropdown render the link,
    // so query all and assert presence.
    const aiLinks = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('href') === '/admin/ai');

    expect(aiLinks.length).toBeGreaterThan(0);
  });

  describe('chat-integration entry (task 9.1)', () => {
    // Proves all 3 hand-written registration points design.md flags as
    // error-prone: the desktop list-group link, the mobile dropdown's
    // static toggle-button label (a separate branch keyed on the current
    // path -- not derived from the same list), and the MenuLabel switch
    // both of those read from.

    it('renders a link to /admin/chat-integration in BOTH the desktop list-group and the mobile dropdown menu', () => {
      render(<AdminNavigation />);

      const links = screen
        .getAllByRole('link')
        .filter((el) => el.getAttribute('href') === '/admin/chat-integration');

      // One in the desktop list-group, one in the mobile dropdown-menu.
      expect(links).toHaveLength(2);
    });

    it('shows the chat-integration label in the mobile dropdown TOGGLE BUTTON when the current path is under /admin/chat-integration', () => {
      window.history.pushState({}, '', '/admin/chat-integration');

      render(<AdminNavigation />);

      // The toggle button's own label branch (the 3rd registration point) --
      // distinct from the list-group/dropdown-menu links above, since this
      // is plain text inside the collapsed mobile button, not a link.
      const toggleButton = document.getElementById('dropdown-admin-navigation');
      expect(toggleButton).toHaveTextContent('Chat Integration');
    });
  });
});
