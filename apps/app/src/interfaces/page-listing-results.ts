import type { IPageHasId } from '@growi/core';

import type { IPageForItem } from './page';

type ParentPath = string;

export interface RootPageResult {
  rootPage: IPageHasId;
}

export interface AncestorsChildrenResult {
  ancestorsChildren: Record<ParentPath, Partial<IPageForItem>[]>;
}

export interface ChildrenResult {
  children: Partial<IPageForItem>[];
}

export interface V5MigrationStatus {
  isV5Compatible: boolean;
  migratablePagesCount: number;
}
