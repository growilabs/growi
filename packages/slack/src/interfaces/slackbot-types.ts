export const SlackbotType = {
  OFFICIAL: 'officialBot',
  CUSTOM_WITHOUT_PROXY: 'customBotWithoutProxy',
  CUSTOM_WITH_PROXY: 'customBotWithProxy',
} as const;

export type SlackbotType = (typeof SlackbotType)[keyof typeof SlackbotType];
