import type { IPageToDeleteWithMeta } from '@growi/core';
import type { Nullable } from 'vitest';

import type { IPageForItem } from '~/interfaces/page';
import type { IPageForPageDuplicateModal } from '~/stores/modal';

import type { ItemNode } from '../ItemNode';

type TreeItemBaseProps = {
  itemLevel?: number,
  itemNode: ItemNode,
  isEnableActions: boolean,
  isReadOnlyUser: boolean,
  onClickDuplicateMenuItem?(pageToDuplicate: IPageForPageDuplicateModal): void,
  onClickDeleteMenuItem?(pageToDelete: IPageToDeleteWithMeta): void,
  onRenamed?(fromPath: string | undefined, toPath: string): void,
}

export type TreeItemToolProps = TreeItemBaseProps & {
  stateHandlers?: {
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>,
  },
};

export type TreeItemProps = TreeItemBaseProps & {
  targetPathOrId?: Nullable<string>,
  isOpen?: boolean,
  isWipPageShown?: boolean,
  itemClass?: React.FunctionComponent<TreeItemProps>,
  itemClassName?: string,
  customEndComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  customHoveredEndComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  customHeadOfChildrenComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  showAlternativeContent?: boolean,
  customAlternativeComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  onClick?(page: IPageForItem): void,
};
