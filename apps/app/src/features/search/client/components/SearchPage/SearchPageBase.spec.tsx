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

// Capture the props SearchPageBase hands to SearchResultList so the right-pane
// preview selection (`selectedPageId`) can be observed, and the user's preview
// choice can be simulated by invoking the captured `onPageSelected`.
const searchResultListSpy = vi.hoisted(() => ({
  lastProps: undefined as
    | {
        selectedPageId?: string;
        pages: IPageWithSearchMeta[];
        onPageSelected?: (page?: IPageWithSearchMeta) => void;
        onCheckboxChanged?: (isChecked: boolean, pageId: string) => void;
      }
    | undefined,
}));

// Decouple from the real list: only the imperative selectAll/deselectAll surface
// and the selection props are relevant to SearchPageBase, so provide a
// ref-forwarding stub that records its props and renders nothing.
vi.mock('./SearchResultList', () => ({
  SearchResultList: React.forwardRef<
    ISelectableAll,
    {
      selectedPageId?: string;
      pages: IPageWithSearchMeta[];
      onPageSelected?: (page?: IPageWithSearchMeta) => void;
      onCheckboxChanged?: (isChecked: boolean, pageId: string) => void;
    }
  >((props, ref) => {
    searchResultListSpy.lastProps = props;
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

describe('SearchPageBase right-pane preview initial selection (2-stage, resetKey-driven)', () => {
  beforeEach(() => {
    searchResultListSpy.lastProps = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('selects the first item as preview on the first data arrival for a new search', () => {
    const ref = createRef<SelectableRef>();

    render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={[createPage('a'), createPage('b')]}
        {...noopControls}
      />,
    );

    expect(searchResultListSpy.lastProps?.selectedPageId).toBe('a');
  });

  it('keeps the user-selected preview when pages are appended under the same resetKey', () => {
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

    // the first item is the initial preview
    expect(searchResultListSpy.lastProps?.selectedPageId).toBe('a');

    // user picks a non-first item as the preview
    act(() => {
      searchResultListSpy.lastProps?.onPageSelected?.(initialPages[1]);
    });
    expect(searchResultListSpy.lastProps?.selectedPageId).toBe('b');

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

    // the user's chosen preview is preserved, not reset to the first item
    expect(searchResultListSpy.lastProps?.selectedPageId).toBe('b');
  });

  it('resets the preview to the new first item when the resetKey changes', () => {
    const ref = createRef<SelectableRef>();
    const firstSearchPages = [createPage('a'), createPage('b')];

    const { rerender } = render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={firstSearchPages}
        {...noopControls}
      />,
    );

    // user picks a non-first item as the preview under the first search
    act(() => {
      searchResultListSpy.lastProps?.onPageSelected?.(firstSearchPages[1]);
    });
    expect(searchResultListSpy.lastProps?.selectedPageId).toBe('b');

    // new search / condition change => resetKey changes; new data has not arrived yet
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-2"
        pages={[]}
        {...noopControls}
      />,
    );

    // first data arrival for the new resetKey => first item of the new results
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-2"
        pages={[createPage('x'), createPage('y')]}
        {...noopControls}
      />,
    );

    expect(searchResultListSpy.lastProps?.selectedPageId).toBe('x');
  });
});

describe('SearchPageBase select-all header follows appended pages (append re-notify)', () => {
  beforeEach(() => {
    searchResultListSpy.lastProps = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('re-notifies partial selection (indeterminate) when unselected pages are appended under the same resetKey', () => {
    const ref = createRef<SelectableRef>();
    const onChanged = vi.fn();
    const initialPages = [createPage('a'), createPage('b')];

    const { rerender } = render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={initialPages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    // select every currently-loaded item => parent renders "checked"
    act(() => {
      ref.current?.selectAll();
    });

    onChanged.mockClear();

    // append more (unselected) pages via infinite scroll under the SAME resetKey
    const appendedPages = [...initialPages, createPage('c'), createPage('d')];
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={appendedPages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    // parent is re-notified with the CURRENT selected count vs the CURRENT
    // accumulated total => selectedCount(2) < totalCount(4) => indeterminate (Req 4.5)
    expect(onChanged).toHaveBeenLastCalledWith(2, 4);
  });

  it('re-notifies full selection (checked) when the appended pages are also selected', () => {
    const ref = createRef<SelectableRef>();
    const onChanged = vi.fn();
    const initialPages = [createPage('a'), createPage('b')];

    const { rerender } = render(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={initialPages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    // the accumulated selection already covers every page that will be loaded:
    // the two visible pages plus the two about to be appended
    act(() => {
      searchResultListSpy.lastProps?.onCheckboxChanged?.(true, 'a');
      searchResultListSpy.lastProps?.onCheckboxChanged?.(true, 'b');
      searchResultListSpy.lastProps?.onCheckboxChanged?.(true, 'c');
      searchResultListSpy.lastProps?.onCheckboxChanged?.(true, 'd');
    });

    onChanged.mockClear();

    // append the remaining pages under the SAME resetKey
    const appendedPages = [...initialPages, createPage('c'), createPage('d')];
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-1"
        pages={appendedPages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    // every accumulated page is selected => selectedCount(4) === totalCount(4)
    // => parent keeps "checked" after the append (Req 4.6)
    expect(onChanged).toHaveBeenLastCalledWith(4, 4);
  });

  it('does not double-fire the append re-notify on a resetKey change (still notifies count 0)', () => {
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

    onChanged.mockClear();

    // new search / condition change => resetKey changes AND pages reference changes
    const newPages = [createPage('x'), createPage('y')];
    rerender(
      <SearchPageBase
        ref={ref}
        resetKey="search-2"
        pages={newPages}
        onSelectedPagesByCheckboxesChanged={onChanged}
        {...noopControls}
      />,
    );

    // the selection-clear effect owns the notification on a resetKey change;
    // the append re-notify must not fight it
    expect(onChanged).toHaveBeenLastCalledWith(0, 0);
  });
});
