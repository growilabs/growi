export type IResAdminHome = {
  growiVersion: string;
  nodeVersion: string;
  npmVersion: string;
  pnpmVersion: string;
  envVars: Record<string, string>;
  isV5Compatible: boolean;
  isMaintenanceMode: boolean;
};
