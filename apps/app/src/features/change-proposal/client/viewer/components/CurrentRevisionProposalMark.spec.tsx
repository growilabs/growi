// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

import { CurrentRevisionProposalMark } from './CurrentRevisionProposalMark';

const mocks = vi.hoisted(() => ({
  useIsGuestUser: vi.fn<() => boolean>(),
  useIsSharedUser: vi.fn<() => boolean>(),
  useSWRxPageInfo: vi.fn(),
  useSWRxRevisionMarks: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/states/context', () => ({
  useIsGuestUser: mocks.useIsGuestUser,
  useIsSharedUser: mocks.useIsSharedUser,
}));
vi.mock('~/stores/page', () => ({
  useSWRxPageInfo: mocks.useSWRxPageInfo,
}));
vi.mock('../stores/use-swrx-revision-marks', () => ({
  useSWRxRevisionMarks: mocks.useSWRxRevisionMarks,
}));

const setMarks = (marks: Record<string, unknown>) => {
  mocks.useSWRxRevisionMarks.mockReturnValue({
    marks: new Map(Object.entries(marks)),
    isLoading: false,
  });
};

describe('CurrentRevisionProposalMark', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useIsGuestUser.mockReturnValue(false);
    mocks.useIsSharedUser.mockReturnValue(false);
    mocks.useSWRxPageInfo.mockReturnValue({
      data: {
        isNotFound: false,
        isEmpty: false,
        latestRevisionId: 'current-rev',
      },
    });
    setMarks({});
  });

  it('passes only the current revision id to the marks hook and shows its mark', () => {
    setMarks({
      'current-rev': {
        revisionId: 'current-rev',
        proposalId: 'prop1',
        isRevert: false,
      },
    });

    render(<CurrentRevisionProposalMark pageId="page1" />);

    expect(mocks.useSWRxRevisionMarks).toHaveBeenCalledWith(['current-rev']);
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      '/me/change-proposals/prop1',
    );
  });

  it('renders nothing when the current revision has no mark', () => {
    const { container } = render(
      <CurrentRevisionProposalMark pageId="page1" />,
    );

    expect(container.textContent).toBe('');
  });

  it.each([
    ['guest', true, false],
    ['shared-link', false, true],
  ])('renders nothing and requests no marks for a %s viewer', (_label, guest, shared) => {
    mocks.useIsGuestUser.mockReturnValue(guest);
    mocks.useIsSharedUser.mockReturnValue(shared);
    setMarks({
      'current-rev': {
        revisionId: 'current-rev',
        proposalId: 'p',
        isRevert: false,
      },
    });

    const { container } = render(
      <CurrentRevisionProposalMark pageId="page1" />,
    );

    expect(mocks.useSWRxRevisionMarks).toHaveBeenLastCalledWith(null);
    expect(container.textContent).toBe('');
  });

  it('does not request marks while the page info has no current revision', () => {
    mocks.useSWRxPageInfo.mockReturnValue({ data: undefined });

    render(<CurrentRevisionProposalMark pageId="page1" />);

    expect(mocks.useSWRxRevisionMarks).toHaveBeenLastCalledWith(null);
  });
});
