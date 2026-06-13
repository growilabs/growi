import type { SidebarContentsType } from './ui.js';

export interface IUserUISettings {
  currentSidebarContents: SidebarContentsType;
  currentProductNavWidth: number;
  preferCollapsedModeByUser: boolean;
}
