import { configManager } from '~/server/service/config-manager/index.js';

export const isAiEnabled = (): boolean =>
  configManager.getConfig('app:aiEnabled');
