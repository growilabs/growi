import mongoose from 'mongoose';

import Contribution from '../models/contribution-model';

export const getContributions = async (userId: string) => {
  if (typeof userId !== 'string' || !mongoose.Types.ObjectId.isValid(userId)) {
    return null;
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
