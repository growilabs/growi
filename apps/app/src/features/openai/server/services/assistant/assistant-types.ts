export const AssistantType = {
  SEARCH: 'Search',
  CHAT: 'Chat',
  EDIT: 'Edit',
} as const;

export type AssistantType = (typeof AssistantType)[keyof typeof AssistantType];
