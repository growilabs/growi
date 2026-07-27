// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
