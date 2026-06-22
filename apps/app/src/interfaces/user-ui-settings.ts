import type { SidebarContentsType } from './ui';

export interface IUserUISettings {
  currentSidebarContents: SidebarContentsType;
  currentProductNavWidth: number;
  preferCollapsedModeByUser: boolean;
  // Last model the user picked in the Mastra AI chat; used as the initial selection on next visit.
  aiChatSelectedModel?: string;
}
