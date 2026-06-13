// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import { EnvOnlyModeNotice } from './EnvOnlyModeNotice';

describe('EnvOnlyModeNotice', () => {
  it('renders an alert when env-only mode is enabled', () => {
    // Act
    render(<EnvOnlyModeNotice useOnlyEnvVars />);

    // Assert
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders nothing when env-only mode is disabled', () => {
    // Act
    const { container } = render(<EnvOnlyModeNotice useOnlyEnvVars={false} />);

    // Assert
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
