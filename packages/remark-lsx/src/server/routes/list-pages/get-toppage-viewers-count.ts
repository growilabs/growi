import type { IPage } from '@growi/core';
import { model } from 'mongoose';

export const getToppageViewersCount = async (): Promise<number> => {
  const Page = model<IPage>('Page');

  const aggRes = await Page.aggregate<{ count: number }>([
    { $match: { path: '/' } },
    { $project: { count: { $size: '$seenUsers' } } },
  ]);

  return aggRes.length > 0 ? aggRes[0].count : 1;
};
