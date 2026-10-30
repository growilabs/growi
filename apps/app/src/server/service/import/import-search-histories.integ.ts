import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import {
  listSearchHistories,
  recordSearchHistory,
  SEARCH_HISTORY_RETENTION_LIMIT,
} from '~/features/search/server/services/search-history';
import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';
import { buildImportSettingsMap } from '~/server/routes/apiv3/import-settings-builder';
import { configManager } from '~/server/service/config-manager';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { ImportService } from '~/server/service/import/import';
import { prisma } from '~/utils/prisma';

const COLLECTION_NAME = 'searchhistories';
const JSON_FILE_NAME = 'searchhistories.json';

type ExportedSearchHistory = {
  _id: string;
  user: string;
  keyword: string;
  lastSearchedAt: string;
};

// The shape the exporter writes: ObjectIds and Dates as strings.
const toExported = (
  userId: string,
  keyword: string,
  lastSearchedAt: Date,
): ExportedSearchHistory => ({
  _id: new ObjectId().toString(),
  user: userId,
  keyword,
  lastSearchedAt: lastSearchedAt.toISOString(),
});

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);

describe('ImportService.import — searchhistories round trip', () => {
  let importService: ImportService;
  let tmpDir: string;
  let importsDir: string;
  const userIds: string[] = [];

  const newUserId = (): string => {
    const userId = new ObjectId().toString();
    userIds.push(userId);
    return userId;
  };

  const importSearchHistories = async (
    docs: readonly ExportedSearchHistory[],
  ): Promise<void> => {
    await fs.writeFile(
      path.join(importsDir, JSON_FILE_NAME),
      JSON.stringify(docs),
    );
    const importSettingsMap = buildImportSettingsMap(
      [{ fileName: JSON_FILE_NAME, collectionName: COLLECTION_NAME }],
      [new GrowiArchiveImportOption(COLLECTION_NAME, ImportMode.insert)],
      new ObjectId().toString(),
    );

    const result = await importService.import(
      [COLLECTION_NAME],
      importSettingsMap,
    );

    expect(result.failedCollections).toEqual([]);
  };

  const countOf = (userId: string): Promise<number> =>
    prisma.searchhistories.count({ where: { userId } });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-searchhist-'));
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

    await configManager.loadConfigs();
  }, 120_000);

  afterEach(async () => {
    await fs.rm(path.join(importsDir, JSON_FILE_NAME), { force: true });
  });

  afterAll(async () => {
    await prisma.searchhistories.deleteMany({
      where: { userId: { in: userIds } },
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores the owner as an ObjectId and the timestamp as a Date, and lists the row', async () => {
    const userId = newUserId();
    const exported = toExported(userId, 'imported keyword', minutesAgo(5));

    await importSearchHistories([exported]);

    const stored = await mongoose.connection
      .collection(COLLECTION_NAME)
      .findOne({ _id: new ObjectId(exported._id) });
    expect(stored?.user).toBeInstanceOf(ObjectId);
    expect(stored?.user.toString()).toBe(userId);
    expect(stored?.lastSearchedAt).toBeInstanceOf(Date);
    expect(stored?.lastSearchedAt.toISOString()).toBe(exported.lastSearchedAt);

    expect(await listSearchHistories(userId)).toEqual([
      {
        _id: exported._id,
        keyword: 'imported keyword',
        lastSearchedAt: new Date(exported.lastSearchedAt),
      },
    ]);
  });

  it('keeps a keyword shaped like an ISO date as a string and lists the row', async () => {
    const userId = newUserId();
    const keyword = '2024-10-30T00:00:00Z';
    const exported = toExported(userId, keyword, minutesAgo(5));

    await importSearchHistories([exported]);

    const stored = await mongoose.connection
      .collection(COLLECTION_NAME)
      .findOne({ _id: new ObjectId(exported._id) });
    expect(stored?.keyword).toBe(keyword);
    expect(
      (await listSearchHistories(userId)).map((item) => item.keyword),
    ).toEqual([keyword]);
  });

  it('re-recording an imported keyword bumps that row instead of adding one', async () => {
    const userId = newUserId();
    const imported = toExported(userId, 'imported keyword', minutesAgo(10));
    const newer = toExported(userId, 'newer keyword', minutesAgo(5));
    await importSearchHistories([imported, newer]);

    const recorded = await recordSearchHistory(userId, 'imported keyword');

    expect(recorded._id).toBe(imported._id);
    expect(recorded.lastSearchedAt.getTime()).toBeGreaterThan(
      new Date(newer.lastSearchedAt).getTime(),
    );
    expect(await countOf(userId)).toBe(2);
    expect((await listSearchHistories(userId)).map((item) => item._id)).toEqual(
      [imported._id, newer._id],
    );
  });

  it('trims imported rows that fall past the retention limit on the next record', async () => {
    const userId = newUserId();
    // index 0 is the newest; the last one is the oldest
    const imported = Array.from(
      { length: SEARCH_HISTORY_RETENTION_LIMIT },
      (_, i) => toExported(userId, `imported ${i}`, minutesAgo(i + 1)),
    );
    const oldest = imported[imported.length - 1];
    await importSearchHistories(imported);

    const recorded = await recordSearchHistory(userId, 'brand new keyword');

    const listed = await listSearchHistories(userId);
    expect(await countOf(userId)).toBe(SEARCH_HISTORY_RETENTION_LIMIT);
    expect(listed[0]._id).toBe(recorded._id);
    expect(listed.map((item) => item._id)).not.toContain(oldest._id);
  });
});
