/**
 * `sharelinks.relatedPage` is a required Prisma relation to `pages` — a ShareLink
 * cannot represent "its page is gone." An import can produce exactly that in either
 * direction: `pages` can be replaced (`flushAndInsert`) with documents unrelated to
 * a pre-existing ShareLink's `relatedPage`, or `sharelinks` can be replaced by an
 * archive's own rows whose `relatedPage` only ever existed on the source wiki. Both
 * are reachable independently of which collections are selected together (see
 * `ImportService.pruneOrphanedShareLinks`).
 *
 * These tests read `sharelinks` back **from the database with the raw driver**, for
 * the same reason the maintenance-mode tests do: the prune is a raw-driver write, so
 * an in-memory/model-layer read would not observe it.
 *
 * They empty the `pages` collection, hence the `.exclusive.` file name.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import type { ImportSettings } from '~/server/service/import';
import { ImportService } from '~/server/service/import/import';

const PAGES_JSON = 'pages.json';
const SHARE_LINKS_JSON = 'sharelinks.json';

const EXISTING_PAGE_ID = '0123456789abcdef01450001';
const NONEXISTENT_PAGE_ID = '0123456789abcdef01450099';

describe('ImportService.import — pruning orphaned sharelinks', () => {
  let importService: ImportService;
  let tmpDir: string;
  let importsDir: string;

  const readShareLinksFromDb = async (): Promise<unknown[]> => {
    return mongoose.connection.collection('sharelinks').find({}).toArray();
  };

  const seedPage = async (id: string): Promise<void> => {
    await mongoose.connection.collection('pages').insertOne({
      _id: new mongoose.Types.ObjectId(id),
      path: `/test-${id}`,
    });
  };

  const seedShareLink = async (relatedPageId: string): Promise<void> => {
    await mongoose.connection.collection('sharelinks').insertOne({
      relatedPage: new mongoose.Types.ObjectId(relatedPageId),
      createdAt: new Date(),
    });
  };

  const writeJson = async (
    fileName: string,
    content: string,
  ): Promise<void> => {
    await fs.writeFile(path.join(importsDir, fileName), content);
  };

  const runImport = (
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<unknown> => {
    return importService.import(
      [...importSettingsMap.keys()],
      importSettingsMap,
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-sharelinks-flush-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    importService = new ImportService(crowi);
  }, 120_000);

  afterEach(async () => {
    await mongoose.connection.collection('sharelinks').deleteMany({});
    await mongoose.connection.collection('pages').deleteMany({});
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('removes a ShareLink whose relatedPage was deleted by a pages flushAndInsert, even though sharelinks was not selected for import', async () => {
    await seedPage(EXISTING_PAGE_ID);
    await seedShareLink(EXISTING_PAGE_ID);
    await writeJson(PAGES_JSON, '[]');

    await runImport(
      new Map([
        [
          'pages',
          {
            mode: ImportMode.flushAndInsert,
            jsonFileName: PAGES_JSON,
            overwriteParams: {},
          },
        ],
      ]),
    );

    expect(await readShareLinksFromDb()).toHaveLength(0);
  });

  test('removes a ShareLink whose relatedPage was deleted, even when the pages import itself fails partway through', async () => {
    await seedPage(EXISTING_PAGE_ID);
    await seedShareLink(EXISTING_PAGE_ID);
    // A closing bracket where the parser expects a value: the read throws part-way
    // through the pipeline, after `deleteMany` has already emptied `pages`.
    await writeJson(PAGES_JSON, '[{"a":]}]');

    await runImport(
      new Map([
        [
          'pages',
          {
            mode: ImportMode.flushAndInsert,
            jsonFileName: PAGES_JSON,
            overwriteParams: {},
          },
        ],
      ]),
    ).catch(() => {});

    expect(await readShareLinksFromDb()).toHaveLength(0);
  });

  test('removes an imported ShareLink whose relatedPage points at a page that only existed on the source wiki, even though pages was not touched', async () => {
    // No page is seeded for NONEXISTENT_PAGE_ID: it stands in for an id that only
    // ever existed on the source wiki the archive came from.
    await writeJson(
      SHARE_LINKS_JSON,
      JSON.stringify([
        {
          _id: '0123456789abcdef01460001',
          relatedPage: NONEXISTENT_PAGE_ID,
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    await runImport(
      new Map([
        [
          'sharelinks',
          {
            mode: ImportMode.insert,
            jsonFileName: SHARE_LINKS_JSON,
            overwriteParams: {},
          },
        ],
      ]),
    );

    expect(await readShareLinksFromDb()).toHaveLength(0);
  });

  test.each([
    ImportMode.insert,
    ImportMode.upsert,
  ])('keeps a ShareLink whose relatedPage still exists after a pages import with mode %s', async (mode) => {
    await seedPage(EXISTING_PAGE_ID);
    await seedShareLink(EXISTING_PAGE_ID);
    await writeJson(PAGES_JSON, '[]');

    await runImport(
      new Map([
        ['pages', { mode, jsonFileName: PAGES_JSON, overwriteParams: {} }],
      ]),
    );

    expect(await readShareLinksFromDb()).toHaveLength(1);
  });
});
