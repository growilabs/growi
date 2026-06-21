export const REQUEST_TIMEOUT_FOR_GTOP = 10000;

export const REQUEST_TIMEOUT_FOR_PTOG = 10000;

export const supportedSlackCommands: string[] = ['/growi'];

export const supportedGrowiCommands: string[] = [
  'search',
  'note',
  'keep',
  'help',
];

export const defaultSupportedCommandsNameForBroadcastUse: string[] = ['search'];

export const defaultSupportedCommandsNameForSingleUse: string[] = [
  'note',
  'keep',
];

export const defaultSupportedSlackEventActions: string[] = ['unfurl'];

export * from './required-scopes';
