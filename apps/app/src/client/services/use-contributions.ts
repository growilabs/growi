import { atom } from 'jotai';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution-graph';

export const targetUserIdAtom = atom<string | null>(null);

export const contributionDataAtom = atom<Promise<IContributionDay[]>>(
  async (get) => {
    const userId = get(targetUserIdAtom);

    if (!userId) {
      return [];
    }

    try {
      const response = await apiv3Get('/activity/contribution', {
        targetUserId: userId,
      });
      return response.data.contributions;
    } catch (err) {
      throw new Error(err);
    }
  },
);
