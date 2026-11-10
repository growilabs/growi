// Proves the `/me/*` first-segment dispatch: the personal-settings and
// notification entries resolve to their components.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routerQuery: {} as Record<string, unknown>,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ query: mocks.routerQuery }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/pages/basic-layout-page/hydrate', () => ({
  useHydrateBasicLayoutConfigurationAtoms: () => {},
}));
vi.mock('./use-hydrate-server-configurations', () => ({
  useHydrateServerConfigurationAtoms: () => {},
}));
vi.mock('~/pages/utils/page-title-customization', () => ({
  useCustomTitle: (title: string) => title,
}));
vi.mock('~/components/Layout/BasicLayout', () => ({
  BasicLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('~/components/Navbar/GroundGlassBar', () => ({
  GroundGlassBar: () => null,
}));

vi.mock('~/client/components/Me/PersonalSettings', () => ({
  default: () => <div>PersonalSettingsMarker</div>,
}));
vi.mock('~/client/components/InAppNotification/InAppNotificationPage', () => ({
  InAppNotificationPage: () => <div>InAppNotificationMarker</div>,
}));

import type { ComponentProps } from 'react';

import MePage from './[[...path]].page';

const BASE_PROPS = {
  serverConfig: { registrationWhitelist: [], showPageLimitationXL: false },
} as unknown as ComponentProps<typeof MePage>;

describe('MePage dispatch', () => {
  beforeEach(() => {
    mocks.routerQuery = {};
  });

  it('resolves the single-segment personal-settings entry (unaffected by the fix)', async () => {
    mocks.routerQuery = { path: ['personal-settings'] };
    render(<MePage {...BASE_PROPS} />);
    expect(
      await screen.findByText('PersonalSettingsMarker'),
    ).toBeInTheDocument();
  });

  it('resolves the single-segment all-in-app-notifications entry (unaffected by the fix)', async () => {
    mocks.routerQuery = { path: ['all-in-app-notifications'] };
    render(<MePage {...BASE_PROPS} />);
    expect(
      await screen.findByText('InAppNotificationMarker'),
    ).toBeInTheDocument();
  });
});
