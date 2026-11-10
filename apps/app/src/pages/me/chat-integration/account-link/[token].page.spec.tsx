// The approval screen is a dedicated page without the GROWI sidebar or
// navigation (Requirement 7.9): it is wrapped in `RawLayout`, never
// `BasicLayout`, and reads the token from `router.query.token`.

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

vi.mock('~/pages/utils/page-title-customization', () => ({
  useCustomTitle: (title: string) => title,
}));
vi.mock('~/components/Layout/RawLayout', () => ({
  RawLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="raw-layout">{children}</div>
  ),
}));
vi.mock('~/components/Layout/BasicLayout', () => ({
  BasicLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="basic-layout">{children}</div>
  ),
}));
vi.mock('~/states/global', () => ({
  useAppTitle: () => 'Acme Wiki',
  useSiteUrl: () => 'https://wiki.example.test',
}));
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: vi.fn().mockResolvedValue({
    data: {
      platform: 'slack',
      accountId: 'U-alice',
      workspaceName: 'Test Workspace',
      relationLabel: null,
      growiUsername: 'approving-user',
      growiName: 'Approving Person',
      accountDisplayName: null,
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
  }),
  apiv3Post: vi.fn(),
}));

import type { ComponentProps } from 'react';

import AccountLinkApprovalPage from './[token].page';

const BASE_PROPS = {} as unknown as ComponentProps<
  typeof AccountLinkApprovalPage
>;

const renderPage = () => {
  const page = <AccountLinkApprovalPage {...BASE_PROPS} />;
  return render(AccountLinkApprovalPage.getLayout?.(page) ?? page);
};

describe('account link approval page', () => {
  beforeEach(() => {
    mocks.routerQuery = { token: 'cd'.repeat(32) };
  });

  it('renders the approval screen for the token in the URL', async () => {
    renderPage();

    expect(
      await screen.findByRole('group', {
        name: 'chat_integration.account_link.chat_account_heading',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('U-alice')).toBeInTheDocument();
  });

  it('does not include the GROWI sidebar layout', async () => {
    renderPage();

    await screen.findByTestId('raw-layout');
    expect(screen.queryByTestId('basic-layout')).not.toBeInTheDocument();
  });
});
