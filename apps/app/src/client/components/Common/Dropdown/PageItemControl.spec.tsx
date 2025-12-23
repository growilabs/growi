import { type IPageInfoForOperation, type IPageInfoForEmpty } from '@growi/core/dist/interfaces';
import {
  fireEvent, screen, within,
} from '@testing-library/dom';
import { render } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { PageItemControl } from './PageItemControl';


// mock for isIPageInfoForOperation and isIPageInfoForEmpty

const mocks = vi.hoisted(() => ({
  isIPageInfoForOperationMock: vi.fn(),
  isIPageInfoForEmptyMock: vi.fn(),
}));

vi.mock('@growi/core/dist/interfaces', () => ({
  isIPageInfoForOperation: mocks.isIPageInfoForOperationMock,
  isIPageInfoForEmpty: mocks.isIPageInfoForEmptyMock,
}));


describe('PageItemControl.tsx', () => {
  describe('Should trigger onClickRenameMenuItem() when clicking the rename button', () => {
    it('without fetching PageInfo by useSWRxPageInfo', async() => {
      // setup
      const pageInfo = mock<IPageInfoForOperation>();

      const onClickRenameMenuItemMock = vi.fn();
      // return true when the argument is pageInfo in order to supress fetching
      mocks.isIPageInfoForOperationMock.mockImplementation((arg) => {
        if (arg === pageInfo) {
          return true;
        }
      });
      // return false for isIPageInfoForEmpty since we're using IPageInfoForOperation
      mocks.isIPageInfoForEmptyMock.mockReturnValue(false);

      const props = {
        pageId: 'dummy-page-id',
        isEnableActions: true,
        pageInfo,
        onClickRenameMenuItem: onClickRenameMenuItemMock,
      };

      render(<PageItemControl {...props} />);

      // when
      const button = within(screen.getByTestId('open-page-item-control-btn')).getByText(/more_vert/);
      fireEvent.click(button);
      const renameMenuItem = await screen.findByTestId('rename-page-btn');
      fireEvent.click(renameMenuItem);

      // then
      expect(onClickRenameMenuItemMock).toHaveBeenCalled();
    });

    it('with empty page (IPageInfoForEmpty)', async() => {
      // setup - Create an empty page mock with required properties
      const pageInfo: IPageInfoForEmpty = {
        emptyPageId: 'empty-page-id',
        isNotFound: false,
        isEmpty: true,
        isV5Compatible: true,
        isMovable: true, // Allow rename operation
        isDeletable: true,
        isAbleToDeleteCompletely: false,
        isRevertible: false,
        bookmarkCount: 0,
        isBookmarked: false,
      };

      const onClickRenameMenuItemMock = vi.fn();

      // return false for isIPageInfoForOperation since this is an empty page
      mocks.isIPageInfoForOperationMock.mockReturnValue(false);

      // return true when the argument is pageInfo (empty page)
      mocks.isIPageInfoForEmptyMock.mockImplementation((arg) => {
        if (arg === pageInfo) {
          return true;
        }
        return false;
      });

      const props = {
        pageId: 'dummy-page-id',
        isEnableActions: true,
        pageInfo,
        onClickRenameMenuItem: onClickRenameMenuItemMock,
      };

      render(<PageItemControl {...props} />);

      // when
      const button = within(screen.getByTestId('open-page-item-control-btn')).getByText(/more_vert/);
      fireEvent.click(button);
      const renameMenuItem = await screen.findByTestId('rename-page-btn');
      fireEvent.click(renameMenuItem);

      // then
      expect(onClickRenameMenuItemMock).toHaveBeenCalled();
      expect(onClickRenameMenuItemMock).toHaveBeenCalledWith('dummy-page-id', pageInfo);
    });
  });
});
