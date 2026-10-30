import type React from 'react';
import type { IUserHasId } from '@growi/core';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { mock } from 'vitest-mock-extended';

import { isSearchScopeChildrenAsDefaultAtom } from '~/states/server-configurations';

import {
  useSearchModalActions,
  useSearchModalStatus,
} from '../states/modal/search';

const mocks = vi.hoisted(() => ({
  postSearchHistory: vi.fn(),
  routerPush: vi.fn(),
  routerPathname: { value: '/[[...path]]' },
  setSearchKeyword: vi.fn(),
  currentUser: { value: undefined as IUserHasId | undefined },
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    pathname: mocks.routerPathname.value,
  }),
}));
vi.mock('../services/search-history-api', () => ({
  postSearchHistory: mocks.postSearchHistory,
}));
vi.mock('~/states/global', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/states/global')>()),
  useCurrentUser: () => mocks.currentUser.value,
}));
vi.mock('~/states/page', () => ({
  useCurrentPagePath: () => '/foo/bar',
}));
vi.mock('~/states/search', () => ({
  useSetSearchKeyword: () => mocks.setSearchKeyword,
}));
vi.mock('~/stores/search', () => ({
  useSWRxSearch: () => ({
    isLoading: false,
    data: {
      data: [
        {
          data: {
            _id: 'page-id-1',
            path: '/page-result',
            creator: null,
            seenUsers: [],
          },
        },
      ],
    },
  }),
}));
vi.mock('@growi/ui/dist/components', () => ({
  PagePathLabel: ({ path }: { path: string }) => <span>{path}</span>,
  UserPicture: () => null,
}));

import SearchModal from './SearchModal';

type OpenArgs = {
  keywordOnInit?: string;
  onSearchOverride?: (keyword: string) => void;
  isSearchScopeChildrenAsDefault?: boolean;
};

const renderOpenedModal = ({
  keywordOnInit,
  onSearchOverride,
  isSearchScopeChildrenAsDefault = false,
}: OpenArgs = {}) => {
  const store = createStore();
  store.set(isSearchScopeChildrenAsDefaultAtom, isSearchScopeChildrenAsDefault);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  const { result } = renderHook(
    () => ({
      actions: useSearchModalActions(),
      status: useSearchModalStatus(),
    }),
    { wrapper },
  );
  act(() => result.current.actions.open(keywordOnInit, onSearchOverride));

  render(<SearchModal />, { wrapper });

  return { status: () => result.current.status };
};

const recordedKeywords = (): unknown[] =>
  mocks.postSearchHistory.mock.calls.map(([keyword]) => keyword);

const getInput = (): HTMLInputElement =>
  screen.getByPlaceholderText('Search...');

const typeKeyword = (keyword: string): void => {
  fireEvent.change(getInput(), { target: { value: keyword } });
};

const pressEnter = async (): Promise<void> => {
  await userEvent.type(getInput(), '{Enter}');
};

const getMenuItem = (text: string): HTMLElement => {
  const li = screen.getByText(text).closest('li');
  if (li == null) {
    throw new Error(`menu item not found: ${text}`);
  }
  return li;
};

describe('SearchModal search history recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.value = mock<IUserHasId>({ _id: 'user-id' });
    mocks.routerPathname.value = '/[[...path]]';
    mocks.postSearchHistory.mockResolvedValue({
      _id: 'history-id',
      keyword: 'k',
      lastSearchedAt: new Date(),
    });
    mocks.routerPush.mockResolvedValue(true);
  });

  describe('Enter', () => {
    it('records the trimmed input without the prefix: added by the children-scope default', async () => {
      const { status } = renderOpenedModal({
        isSearchScopeChildrenAsDefault: true,
      });

      typeKeyword('  hello world  ');
      expect(recordedKeywords()).toEqual([]);

      await pressEnter();

      expect(recordedKeywords()).toEqual(['hello world']);
      expect(mocks.setSearchKeyword).toHaveBeenCalledWith(
        expect.stringContaining('prefix:/foo/bar'),
      );
      expect(status().isOpened).toBe(false);
    });

    it('records the keyword when the modal was opened with a search override (from /_search)', async () => {
      mocks.routerPathname.value = '/_search';
      const onSearchOverride = vi.fn();
      renderOpenedModal({ onSearchOverride });

      typeKeyword('hello');
      await pressEnter();

      expect(recordedKeywords()).toEqual(['hello']);
      expect(onSearchOverride).toHaveBeenCalledWith('hello');
    });

    it('records a prefix: shown in the input on /_search as typed, since the user kept it', async () => {
      mocks.routerPathname.value = '/_search';
      const onSearchOverride = vi.fn();
      renderOpenedModal({
        keywordOnInit: 'prefix:/foo bar',
        onSearchOverride,
        isSearchScopeChildrenAsDefault: true,
      });
      expect(getInput().value).toBe('prefix:/foo bar');

      await pressEnter();

      expect(recordedKeywords()).toEqual(['prefix:/foo bar']);
      expect(onSearchOverride).toHaveBeenCalledWith('prefix:/foo bar');
    });

    it('does not record on /_private-legacy-pages, but still searches', async () => {
      mocks.routerPathname.value = '/_private-legacy-pages';
      const onSearchOverride = vi.fn();
      renderOpenedModal({ onSearchOverride });

      typeKeyword('hello');
      await pressEnter();

      expect(recordedKeywords()).toEqual([]);
      expect(onSearchOverride).toHaveBeenCalledWith('hello');
    });

    it('does not record on /_private-legacy-pages when opened without a search override (e.g. the / shortcut)', async () => {
      mocks.routerPathname.value = '/_private-legacy-pages';
      renderOpenedModal();

      typeKeyword('hello');
      await pressEnter();

      expect(recordedKeywords()).toEqual([]);
      expect(mocks.setSearchKeyword).toHaveBeenCalledWith('hello');
    });

    it('does not record for a guest, but still searches', async () => {
      mocks.currentUser.value = undefined;
      renderOpenedModal();

      typeKeyword('hello');
      await pressEnter();

      expect(recordedKeywords()).toEqual([]);
      expect(mocks.setSearchKeyword).toHaveBeenCalledWith('hello');
    });

    it('does not record a keyword longer than 200 characters, but still searches', async () => {
      const longKeyword = 'a'.repeat(201);
      renderOpenedModal();

      typeKeyword(longKeyword);
      await pressEnter();

      expect(recordedKeywords()).toEqual([]);
      expect(mocks.setSearchKeyword).toHaveBeenCalledWith(longKeyword);
    });

    it('searches and closes the modal without waiting for the record to complete', async () => {
      mocks.postSearchHistory.mockReturnValue(new Promise(() => {}));
      const { status } = renderOpenedModal();

      typeKeyword('hello');
      await pressEnter();

      expect(recordedKeywords()).toEqual(['hello']);
      expect(mocks.setSearchKeyword).toHaveBeenCalledWith('hello');
      expect(status().isOpened).toBe(false);
    });
  });

  describe('selecting a menu item', () => {
    it.each([
      {
        name: 'search in all',
        label: 'search_method_menu_item.search_in_all',
        url: '/_search?q=hello',
        recorded: 'hello',
      },
      {
        name: 'only children',
        label: 'search_method_menu_item.only_children_of_this_tree',
        url: '/_search?q=prefix:/foo/bar hello',
        recorded: 'hello',
      },
      {
        name: 'exact match',
        label: 'search_method_menu_item.exact_mutch',
        url: '/_search?q="hello"',
        recorded: '"hello"',
      },
    ])('records the keyword of the $name method item and navigates to its URL', async ({
      label,
      url,
      recorded,
    }) => {
      const { status } = renderOpenedModal();

      typeKeyword('hello');
      fireEvent.click(getMenuItem(label));

      expect(recordedKeywords()).toEqual([recorded]);
      expect(mocks.routerPush).toHaveBeenCalledWith(url);
      await waitFor(() => expect(status().isOpened).toBe(false));
    });

    it('navigates to a page result without recording', async () => {
      const { status } = renderOpenedModal();

      typeKeyword('hello');
      fireEvent.click(getMenuItem('/page-result'));

      expect(mocks.routerPush).toHaveBeenCalledWith('page-id-1');
      await waitFor(() => expect(status().isOpened).toBe(false));
      expect(recordedKeywords()).toEqual([]);
    });

    it('does not record the children method item for a blank input, but still navigates', () => {
      renderOpenedModal();

      typeKeyword('   ');
      fireEvent.click(
        within(screen.getByTestId('search-prefix-menu-item')).getByRole(
          'option',
        ),
      );

      expect(mocks.routerPush).toHaveBeenCalledWith(
        '/_search?q=prefix:/foo/bar    ',
      );
      expect(recordedKeywords()).toEqual([]);
    });

    it('does not record a method item on /_private-legacy-pages', () => {
      mocks.routerPathname.value = '/_private-legacy-pages';
      renderOpenedModal();

      typeKeyword('hello');
      fireEvent.click(getMenuItem('search_method_menu_item.search_in_all'));

      expect(mocks.routerPush).toHaveBeenCalledWith('/_search?q=hello');
      expect(recordedKeywords()).toEqual([]);
    });

    it('does not record a method item for a guest', () => {
      mocks.currentUser.value = undefined;
      renderOpenedModal();

      typeKeyword('hello');
      fireEvent.click(getMenuItem('search_method_menu_item.search_in_all'));

      expect(mocks.routerPush).toHaveBeenCalledWith('/_search?q=hello');
      expect(recordedKeywords()).toEqual([]);
    });

    it('navigates without waiting for the record to complete', () => {
      mocks.postSearchHistory.mockReturnValue(new Promise(() => {}));
      renderOpenedModal();

      typeKeyword('hello');
      fireEvent.click(getMenuItem('search_method_menu_item.search_in_all'));

      expect(recordedKeywords()).toEqual(['hello']);
      expect(mocks.routerPush).toHaveBeenCalledWith('/_search?q=hello');
    });
  });
});
