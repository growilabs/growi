/**
 * An import that fails part-way has to say so (requirement 2.8).
 *
 * The import deliberately carries on past a collection it could not read — that policy is
 * unchanged — but until now it kept that entirely to itself, logging the failure and
 * emitting a progress event while returning nothing. The caller therefore could not tell
 * a completed transfer from one that left the destination half filled, and the operator
 * on the source side was told the transfer had finished.
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
import { configManager } from '~/server/service/config-manager';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import type { ImportSettings } from '~/server/service/import';
import { ImportService } from '~/server/service/import/import';

const READABLE_TAG = {
  _id: '0123456789abcdef01450001',
  name: 'g2g-import-result-tag',
} as const;

const TAGS_JSON = 'tags.json';
const RELATIONS_JSON = 'pagetagrelations.json';

/**
 * A closing bracket where the parser expects a value, which is one of the few malformed
 * shapes the streaming parser actually rejects. Measured alternatives that it accepts in
 * silence, and that would therefore make this test claim success for an import that never
 * read anything: an unterminated array (`[{"a":1}`), a missing value (`[{"a":}]`, yields
 * `{}`), and an unclosed string.
 */
const UNPARSEABLE_JSON = '[{"a":]}]';

describe('ImportService.import — reporting the collections that failed', () => {
  let importService: ImportService;
  let tmpDir: string;
  let importsDir: string;

  const buildImportSettings = (jsonFileName: string): ImportSettings => ({
    mode: ImportMode.insert,
    jsonFileName,
    overwriteParams: {},
  });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-import-result-'));
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
    await mongoose.connection
      .collection('tags')
      .deleteMany({ name: READABLE_TAG.name });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('names the collection that failed and still imports the others', async () => {
    await fs.writeFile(
      path.join(importsDir, TAGS_JSON),
      JSON.stringify([READABLE_TAG]),
    );
    await fs.writeFile(path.join(importsDir, RELATIONS_JSON), UNPARSEABLE_JSON);

    const result = await importService.import(
      ['tags', 'pagetagrelations'],
      new Map([
        ['tags', buildImportSettings(TAGS_JSON)],
        ['pagetagrelations', buildImportSettings(RELATIONS_JSON)],
      ]),
    );

    expect(result.failedCollections).toEqual(['pagetagrelations']);
    // The failure must not have stopped the run: carrying on is the existing policy, and
    // reporting the fact is all that changed.
    expect(
      await mongoose.connection
        .collection('tags')
        .findOne({ name: READABLE_TAG.name }),
    ).not.toBeNull();
  });

  test('reports nothing when every collection could be read', async () => {
    // The counterpart of the case above: without it, an implementation that always
    // reported a failure would satisfy the first test.
    await fs.writeFile(
      path.join(importsDir, TAGS_JSON),
      JSON.stringify([READABLE_TAG]),
    );

    const result = await importService.import(
      ['tags'],
      new Map([['tags', buildImportSettings(TAGS_JSON)]]),
    );

    expect(result.failedCollections).toEqual([]);
  });
});
