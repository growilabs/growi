// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

// Drives isCloud in the component; mutated per test, reset in afterEach.
const cloudMocks = vi.hoisted(() => ({
  growiCloudUri: undefined as string | undefined,
  growiAppIdForGrowiCloud: undefined as number | undefined,
}));

vi.mock('~/states/global', () => ({
  useGrowiCloudUri: () => cloudMocks.growiCloudUri,
  useGrowiAppIdForGrowiCloud: () => cloudMocks.growiAppIdForGrowiCloud,
}));

import { EnvOnlyModeNotice } from './EnvOnlyModeNotice';

afterEach(() => {
  cloudMocks.growiCloudUri = undefined;
  cloudMocks.growiAppIdForGrowiCloud = undefined;
});

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

  it('does not render a cloud link outside GROWI.cloud', () => {
    // Arrange: non-cloud environment (both cloud values default to undefined)

    // Act
    render(<EnvOnlyModeNotice useOnlyEnvVars />);

    // Assert
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links to the GROWI.cloud console for the current app when on GROWI.cloud', () => {
    // Arrange: a cloud environment requires both the URI and the app id
    cloudMocks.growiCloudUri = 'https://cloud.example.com';
    cloudMocks.growiAppIdForGrowiCloud = 123;

    // Act
    render(<EnvOnlyModeNotice useOnlyEnvVars />);

    // Assert: the notice offers a link to this app's cloud management screen
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://cloud.example.com/my/apps/123',
    );
  });
});
