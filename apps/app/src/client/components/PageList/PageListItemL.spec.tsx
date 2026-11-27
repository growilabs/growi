import { createRef } from 'react';
import type { IPageHasId, IUser } from '@growi/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mock } from 'vitest-mock-extended';

import type { ISelectable } from '~/client/interfaces/selectable-all';
import type { IPageWithSearchMeta } from '~/interfaces/search';

import { PageListItemL } from './PageListItemL';

// Row-level collaborators are stubbed: this spec covers the <li> / checkbox
// contract that the virtualized list relies on, not menus, SWR or modals.
vi.mock('~/states/ui/device', () => ({
  useDeviceLargerThanLg: vi.fn(() => [true]),
}));
vi.mock('~/states/ui/modal/page-delete', () => ({
  usePageDeleteModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/states/ui/modal/page-duplicate', () => ({
  usePageDuplicateModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/states/ui/modal/page-rename', () => ({
  usePageRenameModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/states/ui/modal/put-back-page', () => ({
  usePutBackPageModalActions: vi.fn(() => ({ open: vi.fn() })),
}));
vi.mock('~/stores/bookmark', () => ({
  useSWRMUTxCurrentUserBookmarks: vi.fn(() => ({ trigger: vi.fn() })),
}));
vi.mock('~/stores/page', () => ({
  useSWRxPageInfo: vi.fn(() => ({ data: undefined })),
  useSWRMUTxPageInfo: vi.fn(() => ({ trigger: vi.fn() })),
}));
vi.mock('~/client/services/page-operation', () => ({
  bookmark: vi.fn(),
  unbookmark: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock('~/client/util/toastr', () => ({
  toastError: vi.fn(),
}));
vi.mock('~/client/components/Common/Dropdown/PageItemControl', () => ({
  PageItemControl: () => null,
}));
vi.mock('@growi/ui/dist/components', () => ({
  PageListMeta: () => null,
  UserPicture: () => null,
}));
vi.mock('next-i18next', () => ({
  useTranslation: vi.fn(() => ({ t: (key: string) => key })),
}));

const PAGE_ID = 'page-a';

const createPage = (): IPageWithSearchMeta => ({
  data: mock<IPageHasId>({
    _id: PAGE_ID,
    path: '/parent/page-a',
    liker: [],
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastUpdateUser: mock<IUser>(),
  }),
});

const getListItem = (): HTMLElement => {
  const listItem = screen.getByTestId('page-list-item-L').closest('li');
  if (listItem == null) {
    throw new Error('PageListItemL did not render an <li>');
  }
  return listItem;
};

describe('PageListItemL', () => {
  describe('isInitiallyChecked', () => {
    it('renders the checkbox checked when isInitiallyChecked is true', () => {
      render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          onCheckboxChanged={vi.fn()}
          isInitiallyChecked
        />,
      );

      expect(screen.getByTestId('cb-select')).toBeChecked();
    });

    it('renders the checkbox unchecked when isInitiallyChecked is false or omitted', () => {
      const { unmount } = render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          onCheckboxChanged={vi.fn()}
          isInitiallyChecked={false}
        />,
      );
      expect(screen.getByTestId('cb-select')).not.toBeChecked();
      unmount();

      render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          onCheckboxChanged={vi.fn()}
        />,
      );
      expect(screen.getByTestId('cb-select')).not.toBeChecked();
    });

    it('still lets the user toggle an initially checked checkbox and reports the change', async () => {
      const user = userEvent.setup();
      const onCheckboxChanged = vi.fn();
      render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          onCheckboxChanged={onCheckboxChanged}
          isInitiallyChecked
        />,
      );

      await user.click(screen.getByTestId('cb-select'));

      expect(screen.getByTestId('cb-select')).not.toBeChecked();
      expect(onCheckboxChanged).toHaveBeenCalledExactlyOnceWith(false, PAGE_ID);
    });

    it('keeps the imperative select/deselect handle working', () => {
      const selectableRef = createRef<ISelectable>();
      render(
        <PageListItemL
          ref={selectableRef}
          page={createPage()}
          isReadOnlyUser={false}
          onCheckboxChanged={vi.fn()}
          isInitiallyChecked={false}
        />,
      );

      selectableRef.current?.select();
      expect(screen.getByTestId('cb-select')).toBeChecked();

      selectableRef.current?.deselect();
      expect(screen.getByTestId('cb-select')).not.toBeChecked();
    });
  });

  describe('list item attributes for virtualization', () => {
    it('attaches listItemRef to the rendered <li>', () => {
      const listItemRef = createRef<HTMLLIElement>();
      render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          listItemRef={listItemRef}
        />,
      );

      expect(listItemRef.current).toBe(getListItem());
    });

    it('exposes the position and set size on the <li>', () => {
      render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          listItemIndex={4}
          listSize={10}
        />,
      );

      const listItem = getListItem();
      expect(listItem).toHaveAttribute('data-index', '4');
      expect(listItem).toHaveAttribute('aria-posinset', '5');
      expect(listItem).toHaveAttribute('aria-setsize', '10');
    });

    it('passes an unknown set size (-1) through as-is', () => {
      render(
        <PageListItemL
          page={createPage()}
          isReadOnlyUser={false}
          listItemIndex={0}
          listSize={-1}
        />,
      );

      const listItem = getListItem();
      expect(listItem).toHaveAttribute('data-index', '0');
      expect(listItem).toHaveAttribute('aria-posinset', '1');
      expect(listItem).toHaveAttribute('aria-setsize', '-1');
    });

    it('renders no virtualization attributes when the new props are omitted', () => {
      render(<PageListItemL page={createPage()} isReadOnlyUser={false} />);

      const listItem = getListItem();
      expect(listItem).not.toHaveAttribute('data-index');
      expect(listItem).not.toHaveAttribute('aria-posinset');
      expect(listItem).not.toHaveAttribute('aria-setsize');
    });
  });
});
