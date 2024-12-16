import type { Nullable } from '@growi/core';


export const SidebarMode = {
  DRAWER: 'drawer',
  COLLAPSED: 'collapsed',
  DOCK: 'dock',
} as const;
export type SidebarMode = typeof SidebarMode[keyof typeof SidebarMode];

export const SidebarContentsType = {
  CUSTOM: 'custom',
  RECENT: 'recent',
  TREE: 'tree',
  TAG: 'tag',
  BOOKMARKS: 'bookmarks',
  NOTIFICATION: 'notification',
  KNOWNLEDGE_ASSISTANT: 'knowledgeAssistant',
} as const;
export const AllSidebarContentsType = Object.values(SidebarContentsType);
export type SidebarContentsType = typeof SidebarContentsType[keyof typeof SidebarContentsType];


export type ICustomTabContent = {
  Content?: () => JSX.Element,
  i18n?: string,
  Icon?: () => JSX.Element,
  isLinkEnabled?: boolean | ((content: ICustomTabContent) => boolean),
};

export type ICustomNavTabMappings = { [key: string]: ICustomTabContent };


export type OnDeletedFunction = (idOrPaths: string | string[], isRecursively: Nullable<true>, isCompletely: Nullable<true>) => void;
export type OnRenamedFunction = (path: string) => void;
export type OnDuplicatedFunction = (fromPath: string, toPath: string) => void;
export type OnPutBackedFunction = (path: string) => void;
export type onDeletedBookmarkFolderFunction = (bookmarkFolderId: string) => void;
export type OnSelectedFunction = () => void;
