import type { IPageToDeleteWithMeta } from '@growi/core';
import type { CheckboxesFeatureDef, ItemInstance } from '@headless-tree/core';

import type { IPageForTreeItem } from '~/interfaces/page';
import type { IPageForPageDuplicateModal } from '~/states/ui/modal/page-duplicate';

type TreeItemBaseProps<
  TI = IPageForTreeItem,
  I extends ItemInstance<TI> = ItemInstance<TI>,
> = {
  item: I;
  isEnableActions: boolean;
  isReadOnlyUser: boolean;
  onClickDuplicateMenuItem?(pageToDuplicate: IPageForPageDuplicateModal): void;
  onClickDeleteMenuItem?(pageToDelete: IPageToDeleteWithMeta): void;
  onRenamed?(fromPath: string | undefined, toPath: string): void;
};

export type TreeItemToolProps = TreeItemBaseProps;

export type TreeItemWithCheckboxToolProps = TreeItemBaseProps<
  IPageForTreeItem,
  ItemInstance<IPageForTreeItem & CheckboxesFeatureDef<unknown>['itemInstance']>
>;

export type TreeItemProps = TreeItemBaseProps & {
  targetPath: string;
  targetPathOrId?: string | null;
  isWipPageShown?: boolean;
  itemClassName?: string;
  customEndComponents?: Array<React.FunctionComponent<TreeItemToolProps>>;
  customHoveredEndComponents?: Array<
    React.FunctionComponent<TreeItemToolProps>
  >;
  customHeadOfChildrenComponents?: Array<
    React.FunctionComponent<TreeItemToolProps>
  >;
  showAlternativeContent?: boolean;
  customAlternativeComponents?: Array<
    React.FunctionComponent<TreeItemToolProps>
  >;
  onToggle?: () => void;
  onClick?(page: IPageForTreeItem): void;
  onWheelClick?(page: IPageForTreeItem): void;
};
