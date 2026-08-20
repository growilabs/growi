import React from 'react';
import type { IPageHasId } from '@growi/core';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { IPageWithSearchMeta } from '~/interfaces/search';

// --- Capture the props PageListItemL receives, and allow invoking its
// duplicate/rename/delete callbacks from the test (SearchResultList owns the
// wiring under test; the row component itself is exercised by its own spec).
type CapturedPageListItemLProps = {
  page: IPageWithSearchMeta;
  onPageDuplicated?: (fromPath: string, toPath: string) => void;
  onPageRenamed?: (path: string) => void;
  onPageDeleted?: (
    path: string | string[],
    isRecursively?: boolean,
    isCompletely?: boolean,
  ) => void;
};

const pageListItemLSpy = vi.hoisted(() => ({
  lastProps: undefined as CapturedPageListItemLProps | undefined,
}));

vi.mock('~/client/components/PageList/PageListItemL', () => ({
  PageListItemL: React.forwardRef(
    (props: CapturedPageListItemLProps, _ref: React.Ref<unknown>) => {
      pageListItemLSpy.lastProps = props;
      return null;
    },
  ),
}));

vi.mock('~/stores/page-listing', () => ({
  mutatePageTree: vi.fn(),
  mutateRecentlyUpdated: vi.fn(),
  useSWRxPageInfoForList: vi.fn(() => ({ data: undefined })),
}));

const mutateSearchingSpy = vi.hoisted(() => vi.fn());
vi.mock('~/stores/search', () => ({
  mutateSearching: mutateSearchingSpy,
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: vi.fn(() => false),
  useIsReadOnlyUser: vi.fn(() => false),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

import { SearchResultList } from './SearchResultList';

const createPage = (id: string): IPageWithSearchMeta =>
  mock<IPageWithSearchMeta>({
    data: mock<IPageHasId>({ _id: id, path: `/page/${id}` }),
  });

// A-1: mutateSearching()'s filtered mutate() never reaches an active
// useSWRInfinite subscription (SWR skips `$inf$`-prefixed keys), so the
// infinite-scroll page must also revalidate via its OWN bound `mutate`,
// passed down as `onItemMutated`. These tests pin the contract that
// SearchResultList invokes it (in addition to mutateSearching()) on every
// single-row mutation, so a future refactor cannot silently drop it again.
describe('SearchResultList item-mutation wiring (A-1)', () => {
  beforeEach(() => {
    pageListItemLSpy.lastProps = undefined;
    vi.clearAllMocks();
  });

  it('calls onItemMutated (in addition to mutateSearching) when a page is duplicated', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageDuplicated?.('/from', '/to');

    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
    expect(onItemMutated).toHaveBeenCalledTimes(1);
  });

  it('calls onItemMutated (in addition to mutateSearching) when a page is renamed', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageRenamed?.('/renamed');

    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
    expect(onItemMutated).toHaveBeenCalledTimes(1);
  });

  it('calls onItemMutated (in addition to mutateSearching) when a page is deleted', () => {
    const onItemMutated = vi.fn();
    render(
      <SearchResultList
        pages={[createPage('a')]}
        onItemMutated={onItemMutated}
      />,
    );

    pageListItemLSpy.lastProps?.onPageDeleted?.('/deleted', false, false);

    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
    expect(onItemMutated).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onItemMutated is not provided (legacy callers)', () => {
    render(<SearchResultList pages={[createPage('a')]} />);

    expect(() =>
      pageListItemLSpy.lastProps?.onPageDeleted?.('/deleted', false, false),
    ).not.toThrow();
    expect(mutateSearchingSpy).toHaveBeenCalledTimes(1);
  });
});
