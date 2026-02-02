import type mongoose from 'mongoose';

export interface IContributionDay {
  date: string;
  count: number;
}

export interface IContributionCache {
  userId: mongoose.Types.ObjectId;
  lastUpdated: Date;
  currentWeekData: IContributionDay[];
  permanentWeeks: Record<string, IContributionDay[]>;
}
