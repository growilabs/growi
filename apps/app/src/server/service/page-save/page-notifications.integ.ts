import { EventEmitter } from 'node:events';
import type { IUserHasId } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import { preNotifyService } from '~/server/service/pre-notify';
import { prisma } from '~/utils/prisma';

import { emitPageUpdateActivity } from './page-notifications';

const TEST_IP = '10.0.0.125';

type UpdateEmit = readonly unknown[];

const setup = () => {
  const activityEvent = new EventEmitter();
  const emits: UpdateEmit[] = [];
  activityEvent.on('update', (...args: unknown[]) => {
    emits.push(args);
  });
  const crowi = mock<Crowi>({
    events: mock<Crowi['events']>({ activity: activityEvent }),
  });
  return { crowi, emits };
};

describe('emitPageUpdateActivity', () => {
  const pageId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const creatorId = new Types.ObjectId();
  const user = mock<IUserHasId>({ _id: userId.toString() });
  const page = mock<HydratedDocument<PageDocument>>({
    _id: pageId,
    path: '/page-notifications-integ',
    creator: creatorId,
  });

  const seedLastActivity = async (byUserId: Types.ObjectId): Promise<void> => {
    await prisma.activities.createMany({
      data: [
        {
          id: new Types.ObjectId().toString(),
          v: 0,
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          endpoint: '/test/page-notifications',
          ip: TEST_IP,
          snapshot: {
            id: new Types.ObjectId().toHexString(),
            username: 'page-notifications-user',
          },
          userId: byUserId.toString(),
          target: pageId.toString(),
        },
      ],
    });
  };

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('emits one PAGE_UPDATE activity for the given activity id and returns true when the page has no recent update by the user', async () => {
    const { crowi, emits } = setup();
    const activityId = new Types.ObjectId().toString();

    const emitted = await emitPageUpdateActivity(crowi, {
      activityId,
      page,
      user,
    });

    expect(emitted).toBe(true);
    expect(emits).toHaveLength(1);
    const [emittedId, parameters, target, generatePreNotify] = emits[0];
    expect(emittedId).toBe(activityId);
    expect(parameters).toEqual({
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: page,
      action: SupportedAction.ACTION_PAGE_UPDATE,
      contributor: user,
    });
    expect(target).toEqual({ path: page.path, creator: creatorId });
    expect(generatePreNotify).toBe(preNotifyService.generatePreNotify);
  });

  it('emits when the latest update on the page was made by another user', async () => {
    await seedLastActivity(new Types.ObjectId());
    const { crowi, emits } = setup();

    const emitted = await emitPageUpdateActivity(crowi, {
      activityId: new Types.ObjectId().toString(),
      page,
      user,
    });

    expect(emitted).toBe(true);
    expect(emits).toHaveLength(1);
  });

  it('does not emit and returns false when the same user updated the page within the suppression window', async () => {
    await seedLastActivity(userId);
    const { crowi, emits } = setup();

    const emitted = await emitPageUpdateActivity(crowi, {
      activityId: new Types.ObjectId().toString(),
      page,
      user,
    });

    expect(emitted).toBe(false);
    expect(emits).toHaveLength(0);
  });
});
