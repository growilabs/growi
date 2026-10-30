import type { ControllerStateAndHelpers } from 'downshift';

// Augment the global Event interface with downshift's custom property.
// downshift checks event.nativeEvent.preventDownshiftDefault to skip
// its default key handling. See: https://www.downshift-js.com/downshift#customizing-handlers
declare global {
  interface Event {
    preventDownshiftDefault?: boolean;
  }
}

export type NavigateItem = {
  type: 'navigate';
  url: string;
  /** Keyword to record when selected; absent for items that are not a search execution (page results). */
  historyKeyword?: string;
};
export type SearchItem = { type: 'search'; keyword: string };
export type DownshiftItem = NavigateItem | SearchItem;

export type GetItemProps =
  ControllerStateAndHelpers<DownshiftItem>['getItemProps'];
export type GetInputProps =
  ControllerStateAndHelpers<DownshiftItem>['getInputProps'];
