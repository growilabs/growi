/** Audit-logger callback shape (subset of activityService.createActivity). */
export type VaultActivityRecorder = (params: {
  ip: string | undefined;
  endpoint: string;
  action: string;
  user: string | undefined;
  snapshot: { username?: string };
}) => Promise<void>;
