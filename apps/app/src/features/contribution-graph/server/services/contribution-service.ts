import mongoose from 'mongoose';

import Contribution from '../models/contribution-model';

export const getContributions = async (userId: string) => {
  if (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('User ID is invalid');
  }

  try {
    const contributions = await Contribution.find({ user: userId }).exec();

    return contributions;
  } catch {
    throw new Error(
      'Internal Server Error: Could not retrieve contribution data',
    );
  }
};

export const addContribution = async (userId: string) => {
  if (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('User ID is invalid.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    await Contribution.updateOne(
      { user: userId, date: today },
      { $inc: { count: 1 } },
      { upsert: true },
    );
  } catch {
    throw new Error('Could not update contribution');
  }
};
