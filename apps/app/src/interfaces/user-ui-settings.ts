import type { SidebarContentsType } from './ui';

export interface IUserUISettings {
  currentSidebarContents: SidebarContentsType;
  currentProductNavWidth: number;
  preferCollapsedModeByUser: boolean;
}
