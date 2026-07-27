import type { JSX } from 'react';
import React, { createRef } from 'react';
import { act, render } from '@testing-library/react';
import { atom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ISelectableAll } from '~/client/interfaces/selectable-all';
import type { IPageWithSearchMeta } from '~/interfaces/search';

// --- Mock the heavy / environment-coupled dependencies of SearchPageBase ---
// Search service atoms must resolve truthy, otherwise the component early-returns
// the "not configured" placeholder and never mounts the selection layer.
vi.mock('~/states/server-configurations', () => ({
  isSearchServiceConfiguredAtom: atom(true),
  isSearchServiceReachableAtom: atom(true),
}));

vi.mock('~/states/search', () => ({
  useKeywordManager: vi.fn(),
}));

vi.mock('~/states/context', () => ({
  useIsGuestUser: vi.fn(() => false),
  useIsReadOnlyUser: vi.fn(() => false),
}));

vi.mock('~/states/ui/modal/page-delete', () => ({
  usePageDeleteModalActions: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock('~/stores/page-listing', () => ({
  mutatePageTree: vi.fn(),
  mutateRecentlyUpdated: vi.fn(),
}));

vi.mock('~/client/util/toastr', () => ({
  toastSuccess: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock('@growi/ui/dist/components', () => ({
  LoadingSpinner: () => null,
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockDynamic() {
      return null;
    };
  },
}));

// Decouple from the real list: only the imperative selectAll/deselectAll surface
// is relevant to SearchPageBase, so provide a ref-forwarding stub that renders nothing.
vi.mock('./SearchResultList', () => ({
  SearchResultList: React.forwardRef<ISelectableAll>((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      selectAll: vi.fn(),
      deselectAll: vi.fn(),
    }));
    return null;
  }),
}));

import type { IReturnSelectedPageIds } from './SearchPageBase';
import { SearchPageBase } from './SearchPageBase';

type SelectableRef = ISelectableAll & IReturnSelectedPageIds;

const createPage = (id: string): IPageWithSearchMeta =>
  ({
    data: { _id: id, path: `/page/${id}` },
  }) as unknown as IPageWithSearchMeta;

const noopControls = {
  searchControl: null,
  searchResultListHead: (<span />) as JSX.Element,
  searchPager: null,
};

describe('SearchPageBase selection reset (resetKey-driven)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preserves selection when pages are appended under the same resetKey', () => {
    const ref = createRef<SelectableRef>();
    const initialPages = [createPage('a'), createPage('b')];

    const { rerender } = render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={initialPages}
        {...noopControls}
      />,
    );

    // select everything currently loaded
    act(() => {
      ref.current?.selectAll();
    });
    expect(ref.current?.getSelectedPageIds?.().size).toBe(2);

    // append more pages (infinite scroll) with the SAME resetKey
    const appendedPages = [...initialPages, createPage('c'), createPage('d')];
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={appendedPages}
        {...noopControls}
      />,
    );

    // previously selected items remain selected (not cleared by the append)
    const selected = ref.current?.getSelectedPageIds?.();
    expect(selected?.size).toBe(2);
    expect(selected?.has('a')).toBe(true);
    expect(selected?.has('b')).toBe(true);
  });

  it('clears selection and notifies count 0 when resetKey changes', () => {
    const ref = createRef<SelectableRef>();
    const onChanged = vi.fn();
    const pages = [createPage('a'), createPage('b')];

    const { rerender } = render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={pages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    act(() => {
      ref.current?.selectAll();
    });
    expect(ref.current?.getSelectedPageIds?.().size).toBe(2);

    onChanged.mockClear();

    // new search / condition change => resetKey changes
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-2"
        pages={pages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    expect(ref.current?.getSelectedPageIds?.().size).toBe(0);
    expect(onChanged).toHaveBeenLastCalledWith(0, 0);
  });

  it('selectAll selects every accumulated page across appends', () => {
    const ref = createRef<SelectableRef>();

    const { rerender } = render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={[createPage('a'), createPage('b')]}
        {...noopControls}
      />,
    );

    // accumulate more pages under the same resetKey before selecting
    const accumulated = [createPage('a'), createPage('b'), createPage('c')];
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={accumulated}
        {...noopControls}
      />,
    );

    act(() => {
      ref.current?.selectAll();
    });

    const selected = ref.current?.getSelectedPageIds?.();
    expect(selected?.size).toBe(3);
    expect(selected?.has('a')).toBe(true);
    expect(selected?.has('b')).toBe(true);
    expect(selected?.has('c')).toBe(true);
  });
});
