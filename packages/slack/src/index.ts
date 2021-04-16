export const supportedSlackCommands: string[] = [
  '/growi',
];

export const supportedGrowiCommands: string[] = [
  'search',
  'create',
];

export * from './interfaces/growi-command';
export * from './models/errors';
export * from './utils/slash-command-parser';
export * from './utils/block-creater';
