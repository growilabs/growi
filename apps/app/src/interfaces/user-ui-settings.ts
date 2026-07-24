import type { SidebarContentsType } from './ui';

export interface IUserUISettings {
  currentSidebarContents: SidebarContentsType;
  currentProductNavWidth: number;
  preferCollapsedModeByUser: boolean;
  // Last model the user picked in the Mastra AI chat, stored as a provider-qualified
  // modelKey (`${provider}/${modelId}`) so the selection uniquely identifies its owning
  // provider; used as the initial selection on next visit (Req 4.4).
  aiChatSelectedModelKey?: string;
}
