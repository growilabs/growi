import type { IPageForTreeItem } from './page.js';

export interface RootPageResult {
  rootPage: IPageForTreeItem;
}

export interface ChildrenResult {
  children: IPageForTreeItem[];
}

export interface V5MigrationStatus {
  isV5Compatible: boolean;
  migratablePagesCount: number;
}
