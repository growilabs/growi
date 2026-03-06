import type { IPageHasId, IUser, Ref } from '@growi/core/dist/interfaces';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';

export interface IBookmark {
  page: Ref<IPageHasId>;
  user: Ref<IUser>;
}

export interface IBookmarkInfo {
  sumOfBookmarks: number;
  isBookmarked: boolean;
  bookmarkedUsers: IUserSerializedSecurely<IUser>[];
  pageId: string;
}

export interface BookmarkedPage {
  _id: string;
  page: IPageHasId | null;
  user: Ref<IUser>;
  createdAt: Date;
}

export type MyBookmarkList = BookmarkedPage[];

export interface IBookmarkFolder {
  name: string;
  owner: Ref<IUser>;
  parent?: Ref<this>;
}

export interface BookmarkFolderItems extends IBookmarkFolder {
  _id: string;
  childFolder: BookmarkFolderItems[];
  bookmarks: BookmarkedPage[];
}

export const DRAG_ITEM_TYPE = {
  FOLDER: 'FOLDER',
  BOOKMARK: 'BOOKMARK',
} as const;

interface BookmarkDragItem {
  bookmarkFolder: BookmarkFolderItems;
  level: number;
  root: string;
}

export interface DragItemDataType extends BookmarkDragItem, IPageHasId {
  parentFolder: BookmarkFolderItems | null;
}

export type DragItemType = (typeof DRAG_ITEM_TYPE)[keyof typeof DRAG_ITEM_TYPE];
