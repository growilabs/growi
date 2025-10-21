import { addDays } from 'date-fns';

import ThreadRelation from '../../../models/thread-relation';

export const MAX_DAYS_UNTIL_EXPIRATION = 3;

export const normalizeExpiredAtForThreadRelations = async (): Promise<void> => {
  const maxDaysExpiredAt = addDays(new Date(), MAX_DAYS_UNTIL_EXPIRATION);

  await ThreadRelation.updateMany(
    { expiredAt: { $gt: maxDaysExpiredAt } },
    { $set: { expiredAt: maxDaysExpiredAt } },
  );
};
