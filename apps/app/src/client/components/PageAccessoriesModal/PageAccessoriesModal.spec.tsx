import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { atom } from 'jotai';

import { PageAccessoriesModalContents } from '~/states/ui/modal/page-accessories';

import { PageAccessoriesModal } from './PageAccessoriesModal';

// Per-test knobs, read lazily by the module mocks below.
let shareLinkId: string | undefined;
let isGuestUser: boolean;

const selectContents = vi.fn();

vi.mock('~/states/ui/modal/page-accessories', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('~/states/ui/modal/page-accessories')>();
  return {
    ...actual,
    usePageAccessoriesModalStatus: () => ({
      isOpened: true,
      // Any tab other than Backlinks: the gate governs whether the tab can be
      // reached, not what its body renders.
      activatedContents: actual.PageAccessoriesModalContents.Attachment,
    }),
    usePageAccessoriesModalActions: () => ({
      open: vi.fn(),
      close: vi.fn(),
      selectContents,
    }),
  };
});

vi.mock('~/states/context', () => ({
  useIsGuestUser: () => isGuestUser,
  useIsReadOnlyUser: () => false,
  useIsSharedUser: () => false,
}));

vi.mock('~/states/page', () => ({
  useShareLinkId: () => shareLinkId,
}));

vi.mock('~/states/server-configurations', () => ({
  disableLinkSharingAtom: atom(false),
}));

vi.mock('~/states/ui/device', () => ({
  useDeviceLargerThanLg: () => [true],
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Tab bodies are irrelevant here and would pull in SWR fetches.
vi.mock('./PageHistory', () => ({ PageHistory: () => null }));
vi.mock('./PageAttachment', () => ({ default: () => null }));
vi.mock('./ShareLink', () => ({ ShareLink: () => null }));
vi.mock('~/features/backlinks/client/components/BacklinksPanel', () => ({
  BacklinksPanel: () => null,
}));

/**
 * Click the Backlinks tab the way a user would.
 *
 * Uses getByText, not queryByText: if the tab cannot be found the negative test
 * below would otherwise pass vacuously (verified — renaming the tab's i18n key
 * left it green). The gate therefore has to keep the tab rendered and inert; if
 * it is ever changed to hide the tab instead, replace the negative test's call
 * with an explicit absence assertion rather than making this lookup tolerant.
 */
const clickBacklinksTab = async (): Promise<void> => {
  await userEvent.click(screen.getByText('backlinks.panel'));
};

describe('PageAccessoriesModal — reaching the Backlinks tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shareLinkId = undefined;
    isGuestUser = false;
  });

  it('opens for a logged-in viewer', async () => {
    render(<PageAccessoriesModal />);

    await clickBacklinksTab();

    expect(selectContents).toHaveBeenCalledWith(
      PageAccessoriesModalContents.Backlinks,
    );
  });

  // Backlinks are readable without an account on a public wiki, so the gate must
  // not widen to guests — the endpoint admits them deliberately.
  it('opens for a guest', async () => {
    isGuestUser = true;

    render(<PageAccessoriesModal />);

    await clickBacklinksTab();

    expect(selectContents).toHaveBeenCalledWith(
      PageAccessoriesModalContents.Backlinks,
    );
  });

  // A share link grants one page, not the link graph around it.
  it('does not open for a share-link viewer', async () => {
    shareLinkId = 'dummy-share-link-id';

    render(<PageAccessoriesModal />);

    await clickBacklinksTab();

    expect(selectContents).not.toHaveBeenCalled();
  });
});
