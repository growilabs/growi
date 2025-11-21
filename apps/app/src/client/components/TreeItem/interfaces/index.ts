import type { IPageToDeleteWithMeta } from '@growi/core';

import type { IPageForItem } from '~/interfaces/page';
import type { IPageForPageDuplicateModal } from '~/states/ui/modal/page-duplicate';

type TreeItemBaseProps = {
  item: IPageForItem,
  itemLevel: number,
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
  onStartCreatePage?: (parentId: string, parentPath: string) => void,
};

export type TreeItemProps = TreeItemBaseProps & {
  isExpanded: boolean;
  targetPath: string;
  targetPathOrId?: string | null;
  isWipPageShown?: boolean;
  itemClassName?: string,
  customEndComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  customHoveredEndComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  customHeadOfChildrenComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  showAlternativeContent?: boolean,
  customAlternativeComponents?: Array<React.FunctionComponent<TreeItemToolProps>>,
  onToggle: () => void;
  onClick?(page: IPageForItem): void,
  onWheelClick?(page: IPageForItem): void,
  // Optional props for rename feature integration
  isRenaming?: boolean;
  renameInputProps?: any;
  onStartCreatePage?: (parentId: string, parentPath: string) => void;
};
