import { useCallback } from 'react';
import { useSetAtom } from 'jotai';

import { _atomsForMaintenanceMode } from '../../states/global';
import { apiv3Post } from '../util/apiv3-client';

const { isMaintenanceModeAtom } = _atomsForMaintenanceMode;

/**
 * Maintenance Mode Actions
 */
export type MaintenanceModeActions = {
  start: () => Promise<void>;
  end: () => Promise<void>;
};

export const useMaintenanceModeActions = (): MaintenanceModeActions => {
  const setIsMaintenanceMode = useSetAtom(isMaintenanceModeAtom);

  const start = useCallback(async () => {
    await apiv3Post('/app-settings/maintenance-mode', { flag: true });
    setIsMaintenanceMode(true);
  }, [setIsMaintenanceMode]);

  const end = useCallback(async () => {
    await apiv3Post('/app-settings/maintenance-mode', { flag: false });
    setIsMaintenanceMode(false);
  }, [setIsMaintenanceMode]);

  return { start, end };
};
