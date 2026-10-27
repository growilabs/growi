import { ConfigSource } from '@growi/core/dist/interfaces';

import { configManager } from '~/server/service/config-manager';

/** Reads ai:disabledReason from env only. undefined when unset or blank. */
export const readAiDisabledReason = (): string | undefined => {
  const value: unknown = configManager.getConfig(
    'ai:disabledReason',
    ConfigSource.env,
  );
  return typeof value === 'string' && value !== '' ? value : undefined;
};
