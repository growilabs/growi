import type { IUserHasId } from '@growi/core';

export interface IContributionMigrationService {
  migrateContributions(userId: string): Promise<void>;
  ensureUserHasMigrated(user: IUserHasId): Promise<string>;
}
