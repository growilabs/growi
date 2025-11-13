import type { ControllerStateAndHelpers } from 'downshift';

export type DownshiftItem = { url: string };

export type GetItemProps =
  ControllerStateAndHelpers<DownshiftItem>['getItemProps'];
export type GetInputProps =
  ControllerStateAndHelpers<DownshiftItem>['getInputProps'];
