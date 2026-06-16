// biome-ignore lint/style/noRestrictedImports: Type-only import from axios
import type { AxiosResponse } from 'axios';
import { debounce } from 'throttle-debounce';

import type { IUserUISettings } from '~/interfaces/user-ui-settings';

import { apiv3Put } from '../util/apiv3-client';

let settingsForBulk: Partial<IUserUISettings> = {};
const _putUserUISettingsInBulk = (): Promise<
  AxiosResponse<IUserUISettings>
> => {
  const result = apiv3Put<IUserUISettings>('/user-ui-settings', {
    settings: settingsForBulk,
  });

  // clear partial
  settingsForBulk = {};

  return result;
};

const _putUserUISettingsInBulkDebounced = debounce(
  1500,
  _putUserUISettingsInBulk,
);

export const scheduleToPut = (settings: Partial<IUserUISettings>): void => {
  settingsForBulk = {
    ...settingsForBulk,
    ...settings,
  };

  _putUserUISettingsInBulkDebounced();
};

export const updateUserUISettings = async (
  settings: Partial<IUserUISettings>,
): Promise<AxiosResponse<IUserUISettings>> => {
  const result = await apiv3Put<IUserUISettings>('/user-ui-settings', {
    settings,
  });

  return result;
};
