/**
 * Integration tests for exportPagesToFsAsync against a real MongoDB + Prisma.
 *
 * Observable contract: the set of files written to the output dir for a job's
 * snapshots, regardless of how the snapshots fall across read batches or where
 * a previous run stopped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type { pagebulkexportjobs } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

import type { IPageBulkExportJobCronService } from '..';
import { exportPagesToFsAsync } from './export-pages-to-fs-async';

const newObjectId = (): string => new mongoose.Types.ObjectId().toHexString();

describe('exportPagesToFsAsync (real database)', () => {
  let tmpDir: string;
  let job: pagebulkexportjobs;

  beforeAll(() => {
    // getPageWritable resolves the exporting user via mongoose.model('User');
    // no fixture embeds an attachment image, so the user is never read.
    if (!mongoose.modelNames().includes('User')) {
      mongoose.model('User', new mongoose.Schema({}));
    }
  });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-export-integ-'));
    job = await prisma.pagebulkexportjobs.create({
      data: {
        userId: newObjectId(),
        pageId: newObjectId(),
        format: PageBulkExportFormat.md,
        status: PageBulkExportJobStatus.exporting,
      },
    });
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await prisma.pagebulkexportpagesnapshots.deleteMany();
    await prisma.pagebulkexportjobs.deleteMany();
    await prisma.revisions.deleteMany();
  });

  async function seedSnapshot(
    pagePath: string,
    body = `body of ${pagePath}`,
  ): Promise<void> {
    const revision = await prisma.revisions.create({
      data: { pageId: newObjectId(), body },
    });
    await prisma.pagebulkexportpagesnapshots.create({
      data: {
        pageBulkExportJobId: job.id,
        path: pagePath,
        revisionId: revision.id,
      },
    });
  }

  /** Run the export and resolve once every snapshot has been written. */
  async function runExport(
    target: pagebulkexportjobs,
    pageBatchSize: number,
  ): Promise<void> {
    const svc = mock<IPageBulkExportJobCronService>();
    svc.getTmpOutputDir.mockReturnValue(tmpDir);
    svc.pageBatchSize = pageBatchSize;

    const finished = new Promise<void>((resolve, reject) => {
      svc.setStreamsInExecution.mockImplementation((_jobId, _readable, w) => {
        if (w instanceof Writable) {
          w.once('finish', resolve).once('error', reject);
        }
      });
    });
    await exportPagesToFsAsync.call(svc, target);
    await finished;
  }

  const listExportedFiles = (): string[] =>
    fs
      .readdirSync(tmpDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => fs.statSync(path.join(tmpDir, f)).isFile())
      .sort();

  it('exports every snapshot when same-path snapshots straddle a batch boundary', async () => {
    // pages.path is not unique, so two snapshots can share a path. With a batch
    // size of 2 the pair of /b snapshots is split across the first and second
    // batch. Both write to b.md in id order, so the file ends up holding the
    // second snapshot's body only if that snapshot was read.
    await seedSnapshot('/a');
    await seedSnapshot('/b', 'first b');
    await seedSnapshot('/b', 'second b');
    await seedSnapshot('/c');

    await runExport(job, 2);

    expect(listExportedFiles()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(fs.readFileSync(path.join(tmpDir, 'b.md'), 'utf8')).toBe('second b');
  });

  it('exports every snapshot when they span multiple batches', async () => {
    const paths = ['/a', '/b', '/c', '/d', '/e'];
    for (const p of paths) {
      await seedSnapshot(p);
    }

    await runExport(job, 2);

    expect(listExportedFiles()).toEqual(paths.map((p) => `${p.slice(1)}.md`));
    for (const p of paths) {
      expect(
        fs.readFileSync(path.join(tmpDir, `${p.slice(1)}.md`), 'utf8'),
      ).toBe(`body of ${p}`);
    }
  });

  it('resumes after lastExportedPagePath, skipping already-exported pages', async () => {
    await seedSnapshot('/a');
    await seedSnapshot('/b');
    await seedSnapshot('/c');
    const resumed = await prisma.pagebulkexportjobs.update({
      where: { id: job.id },
      data: { lastExportedPagePath: '/a' },
    });

    await runExport(resumed, 2);

    expect(listExportedFiles()).toEqual(['b.md', 'c.md']);
  });
});
