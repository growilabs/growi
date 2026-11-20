// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import type { IPagePopulatedToShowRevision } from '@growi/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { PageSideContents } from './PageSideContents';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: () => true,
}));
vi.mock('~/client/util/smooth-scroll', () => ({ scrollToElement: vi.fn() }));
vi.mock('~/states/context', () => ({
  useIsGuestUser: () => false,
  useIsReadOnlyUser: () => false,
}));
vi.mock('~/states/server-configurations', () => ({
  showPageSideAuthorsAtom: {},
}));
vi.mock('~/states/ui/modal/descendants-page-list', () => ({
  useDescendantsPageListModalActions: () => ({ open: vi.fn() }),
}));
vi.mock('~/states/ui/modal/tag-edit', () => ({
  useTagEditModalActions: () => ({ open: vi.fn() }),
}));
vi.mock('~/states/ui/page-abilities', () => ({
  useIsAbleToShowTagLabel: () => false,
}));
vi.mock('~/stores/page', () => ({
  useSWRxPageInfo: () => ({ data: undefined }),
  useSWRxTagsInfo: () => ({ data: undefined }),
}));
vi.mock('../ContentLinkButtons', () => ({ ContentLinkButtons: () => null }));
vi.mock('../PageTags', () => ({
  PageTags: () => null,
  PageTagsSkeleton: () => null,
}));
vi.mock('../TableOfContents', () => ({ default: () => null }));
vi.mock('./PageAccessoriesControl', () => ({
  PageAccessoriesControl: () => null,
}));
vi.mock('~/client/components/AuthorInfo', () => ({
  AuthorInfo: ({
    mode,
    proposalMark,
  }: {
    mode: string;
    proposalMark?: ReactNode;
  }) => (
    <div data-testid={`author-${mode}`}>
      {mode}
      {proposalMark}
    </div>
  ),
}));
vi.mock('~/features/change-proposal/client/viewer/marks', () => ({
  CurrentRevisionProposalMark: ({ pageId }: { pageId: string }) => (
    <span data-testid="current-mark">{pageId}</span>
  ),
}));

const page = mock<IPagePopulatedToShowRevision>({
  _id: 'page-1',
  path: '/some/page',
  revision: undefined,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
});

describe('PageSideContents', () => {
  it('shows the current-revision mark only next to the last-updated author', async () => {
    render(<PageSideContents page={page} />);

    const update = await screen.findByTestId('author-update');
    const create = await screen.findByTestId('author-create');

    expect(
      update.querySelector('[data-testid="current-mark"]')?.textContent,
    ).toBe('page-1');
    expect(create.querySelector('[data-testid="current-mark"]')).toBeNull();
  });
});
