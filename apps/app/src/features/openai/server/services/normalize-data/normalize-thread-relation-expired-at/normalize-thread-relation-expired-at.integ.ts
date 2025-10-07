import { faker } from '@faker-js/faker';
import { addDays, subDays } from 'date-fns';
import { Types } from 'mongoose';

import { ThreadType } from '../../../../interfaces/thread-relation';
import ThreadRelation from '../../../models/thread-relation';

import {
  MAX_DAYS_UNTIL_EXPIRATION,
  normalizeExpiredAtForThreadRelations,
} from './normalize-thread-relation-expired-at';

describe('normalizeExpiredAtForThreadRelations', () => {
  it('should update expiredAt to 3 days from now for expired thread relations', async () => {
    // arrange
    const expiredDays = faker.number.int({
      min: MAX_DAYS_UNTIL_EXPIRATION,
      max: 30,
    });
    const expiredDate = addDays(new Date(), expiredDays);
    const threadRelation = new ThreadRelation({
      userId: new Types.ObjectId(),
      threadId: 'test-thread',
      aiAssistant: new Types.ObjectId(),
      expiredAt: expiredDate,
      type: ThreadType.KNOWLEDGE,
    });
    await threadRelation.save();

    // act
    await normalizeExpiredAtForThreadRelations();

    // assert
    const updatedThreadRelation = await ThreadRelation.findById(
      threadRelation._id,
    );
    expect(updatedThreadRelation).not.toBeNull();
    assert(updatedThreadRelation?.expiredAt != null);
    expect(
      updatedThreadRelation.expiredAt <
        addDays(new Date(), MAX_DAYS_UNTIL_EXPIRATION),
    ).toBeTruthy();
  });

  it('should not update expiredAt for non-expired thread relations', async () => {
    // arrange
    const nonExpiredDays = faker.number.int({
      min: 0,
      max: MAX_DAYS_UNTIL_EXPIRATION,
    });
    const nonExpiredDate = addDays(new Date(), nonExpiredDays);
    const threadRelation = new ThreadRelation({
      userId: new Types.ObjectId(),
      threadId: 'test-thread-2',
      aiAssistant: new Types.ObjectId(),
      expiredAt: nonExpiredDate,
      type: ThreadType.KNOWLEDGE,
    });
    await threadRelation.save();

    // act
    await normalizeExpiredAtForThreadRelations();

    // assert
    const updatedThreadRelation = await ThreadRelation.findById(
      threadRelation._id,
    );
    expect(updatedThreadRelation).not.toBeNull();
    expect(updatedThreadRelation?.expiredAt).toEqual(nonExpiredDate);
  });

  it('should not update expiredAt is before today', async () => {
    // arrange
    const nonExpiredDate = subDays(new Date(), 1);
    const threadRelation = new ThreadRelation({
      userId: new Types.ObjectId(),
      threadId: 'test-thread-3',
      aiAssistant: new Types.ObjectId(),
      expiredAt: nonExpiredDate,
      type: ThreadType.KNOWLEDGE,
    });
    await threadRelation.save();

    // act
    await normalizeExpiredAtForThreadRelations();

    // assert
    const updatedThreadRelation = await ThreadRelation.findById(
      threadRelation._id,
    );
    expect(updatedThreadRelation).not.toBeNull();
    expect(updatedThreadRelation?.expiredAt).toEqual(nonExpiredDate);
  });
});
