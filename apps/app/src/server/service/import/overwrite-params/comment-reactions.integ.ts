import type { EventEmitter } from 'node:events';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { ImportService } from '~/server/service/import/import';
import { prisma } from '~/utils/prisma';

import { generateOverwriteParams } from './index';

const { ObjectId } = Types;

describe('importing commentreactions in the export format', () => {
  let importService: ImportService;
  const insertedIds: Types.ObjectId[] = [];

  beforeAll(() => {
    const crowi = mock<Crowi>({
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
      },
    });
    importService = new ImportService(crowi);
  });

  afterEach(async () => {
    await mongoose.connection
      .collection('commentreactions')
      .deleteMany({ _id: { $in: insertedIds } });
    insertedIds.length = 0;
  });

  it('restores references to ObjectId and createdAt to Date so Prisma can find them by comment ID', async () => {
    const commentIds = [new ObjectId(), new ObjectId()];
    const exported = [
      {
        _id: new ObjectId(),
        comment: commentIds[0],
        page: new ObjectId(),
        user: new ObjectId(),
        emoji: 'unicode:thumbsup',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        __v: 0,
      },
      {
        _id: new ObjectId(),
        comment: commentIds[1],
        page: new ObjectId(),
        user: new ObjectId(),
        emoji: 'unicode:tada',
        createdAt: new Date('2026-02-03T04:05:06.000Z'),
        __v: 0,
      },
    ].map((doc) => JSON.parse(JSON.stringify(doc)));
    // sanity: the export shape really is all strings
    expect(typeof exported[0].comment).toBe('string');

    const overwriteParams = generateOverwriteParams(
      'commentreactions',
      new ObjectId().toString(),
      {} as GrowiArchiveImportOption,
    );
    const converted = exported.map((doc) =>
      importService.convertDocuments('commentreactions', doc, overwriteParams),
    );
    insertedIds.push(...converted.map((doc) => doc._id));
    await mongoose.connection
      .collection('commentreactions')
      .insertMany(converted);

    const rows = await prisma.commentreactions.findMany({
      where: { commentId: { in: commentIds.map((id) => id.toString()) } },
    });
    expect(rows.map((row) => row.emoji).sort()).toEqual([
      'unicode:+1',
      'unicode:tada',
    ]);

    const raw = await mongoose.connection
      .collection('commentreactions')
      .findOne({ _id: converted[0]._id });
    expect(raw?.comment).toBeInstanceOf(ObjectId);
    expect(raw?.page).toBeInstanceOf(ObjectId);
    expect(raw?.user).toBeInstanceOf(ObjectId);
    expect(raw?.createdAt).toBeInstanceOf(Date);
    expect(raw?.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
});
