import type { IPageForTreeItem } from './page';

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
