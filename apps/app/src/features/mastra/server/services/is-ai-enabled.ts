import { configManager } from '~/server/service/config-manager';

export const isAiEnabled = (): boolean =>
  configManager.getConfig('app:aiEnabled');
