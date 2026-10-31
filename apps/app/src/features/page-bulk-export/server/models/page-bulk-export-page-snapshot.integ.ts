import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

const newObjectId = (): string => new mongoose.Types.ObjectId().toHexString();

describe('pagebulkexportpagesnapshots relations', () => {
  afterEach(async () => {
    await prisma.pagebulkexportpagesnapshots.deleteMany();
    await prisma.pagebulkexportjobs.deleteMany();
  });

  it('allows hard-deleting a job that snapshots still reference, orphaning them', async () => {
    const job = await prisma.pagebulkexportjobs.create({
      data: {
        userId: newObjectId(),
        pageId: newObjectId(),
        format: 'md',
        status: 'exporting',
      },
    });
    const snapshot = await prisma.pagebulkexportpagesnapshots.create({
      data: { pageBulkExportJobId: job.id, path: '/a' },
    });

    await prisma.pagebulkexportjobs.delete({ where: { id: job.id } });

    const orphaned = await prisma.pagebulkexportpagesnapshots.findUniqueOrThrow(
      {
        where: { id: snapshot.id },
      },
    );
    expect(orphaned.pageBulkExportJobId).toBeNull();
  });
});
