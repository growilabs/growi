export interface IAuditLogExportJobSnapshot {
  username: string;
}

export const parseSnapshot = (snapshot: string): IAuditLogExportJobSnapshot => {
  try {
    return JSON.parse(snapshot);
  } catch (error) {
    console.error('Failed to parse audit log export job snapshot:', error, snapshot);
    return {
      username: 'Parse error',
    };
  }
};