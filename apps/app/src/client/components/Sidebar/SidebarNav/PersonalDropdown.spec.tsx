// @vitest-environment happy-dom

import type { IUserHasId } from '@growi/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { PersonalDropdown } from './PersonalDropdown';

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  useChangeProposalEnabled: vi.fn<() => boolean>(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) =>
      options?.ns != null ? `${options.ns}:${key}` : key,
  }),
}));
vi.mock('~/states/global', () => ({
  useCurrentUser: mocks.useCurrentUser,
}));
vi.mock('~/states/server-configurations', async () => {
  const { atom } = await import('jotai');
  return {
    disableUserPagesAtom: atom(false),
    useChangeProposalEnabled: mocks.useChangeProposalEnabled,
  };
});
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Post: vi.fn() }));
vi.mock('~/client/util/toastr', () => ({ toastError: vi.fn() }));

const openMenu = (): void => {
  render(<PersonalDropdown />);
  fireEvent.click(screen.getByTestId('personal-dropdown-button'));
};

const LINK_TEST_ID = 'grw-personal-dropdown-menu-change-proposals';

describe('PersonalDropdown - change proposal list link', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useCurrentUser.mockReturnValue(
      mock<IUserHasId>({
        _id: 'u1',
        name: 'Taro',
        username: 'taro',
        email: 'taro@example.com',
      }),
    );
  });

  it('links to the change proposal list when the feature is enabled', () => {
    mocks.useChangeProposalEnabled.mockReturnValue(true);

    openMenu();

    const link = screen.getByTestId(LINK_TEST_ID);
    expect(link.getAttribute('href')).toBe('/me/change-proposals');
    expect(link.textContent).toContain(
      'translation:change_proposal_viewer.list.title',
    );
  });

  it('does not show the link when the feature is disabled', () => {
    mocks.useChangeProposalEnabled.mockReturnValue(false);

    openMenu();

    expect(screen.queryByTestId(LINK_TEST_ID)).toBeNull();
  });
});
