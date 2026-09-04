/**
 * What `ImportService.import()` tells the outside world when a run ends (requirement 2.8).
 *
 * Two channels, and both used to mislead:
 *
 *  - the **return value**. The import deliberately carries on past a collection it could
 *    not read — that policy is unchanged — but it used to keep that entirely to itself,
 *    logging the failure and emitting a progress event while returning nothing. The caller
 *    could not tell a completed transfer from one that left the destination half filled,
 *    and the operator on the source side was told the transfer had finished.
 *  - the **'onTerminateForImport' event**, which the admin screen turns into a green
 *    "Import process has completed." It used to fire right after the per-collection loop:
 *    before the page normalization that can run for minutes and while the route still held
 *    the import claim, so an operator who acted on it and re-imported was refused with a
 *    409; and it fired for a partly failed run just the same.
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
const PAGES_JSON = 'pages.json';

/**
 * A closing bracket where the parser expects a value, which is one of the few malformed
 * shapes the streaming parser actually rejects. Measured alternatives that it accepts in
 * silence, and that would therefore make this test claim success for an import that never
 * read anything: an unterminated array (`[{"a":1}`), a missing value (`[{"a":}]`, yields
 * `{}`), and an unclosed string.
 */
const UNPARSEABLE_JSON = '[{"a":]}]';

describe('ImportService.import — what a finished run reports', () => {
  let importService: ImportService;
  let tmpDir: string;
  let importsDir: string;
  let adminEvent: EventEmitter;
  /** Counts every 'onTerminateForImport', reset before each case. */
  let terminateCount: number;
  const normalizeAllPublicPages = vi.fn();

  const buildImportSettings = (jsonFileName: string): ImportSettings => ({
    mode: ImportMode.insert,
    jsonFileName,
    overwriteParams: {},
  });

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-import-result-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    adminEvent = new EventEmitter();
    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: adminEvent,
      },
      // The real one walks the whole page tree and takes minutes; the point of the
      // ordering case below is that it holds up the completion signal.
      pageService: { normalizeAllPublicPages },
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    importService = new ImportService(crowi);

    await configManager.loadConfigs();
  }, 120_000);

  beforeEach(() => {
    terminateCount = 0;
    adminEvent.on('onTerminateForImport', () => {
      terminateCount += 1;
    });
    normalizeAllPublicPages.mockResolvedValue(undefined);
  });

  afterEach(() => {
    adminEvent.removeAllListeners('onTerminateForImport');
  });

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

  // `app-integration` has no project-level testTimeout override, so this runs under
  // Vitest's 5000ms default. Unlike the other cases in this file, it drives real file
  // I/O (write + streaming JSON parse) and a real Mongo write with no mocked delay — a
  // fixed, tiny cost that occasionally exceeds 5s under CI's concurrent-worker
  // contention rather than because of anything test-parameter-scaled here (fixture is a
  // single tag record). Seen flaking in growilabs/growi#11858, where a sibling
  // MongoDB-version matrix cell on the same commit passed, ruling out a code regression.
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
    // And the screen must not be told it completed: that event is the operator's cue that
    // the wiki is whole and maintenance mode can come off.
    expect(terminateCount).toBe(0);
  }, 15_000);

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
    expect(terminateCount).toBe(1);
  });

  test('holds back the completion signal until the page normalization is over', async () => {
    // Only a v5-compatible wiki importing `pages` reaches normalizeAllPublicPages, and it
    // is the long part of the run — the stretch during which the route still holds the
    // import claim and answers a re-import with a 409.
    const originalIsV5Compatible =
      configManager.getConfig('app:isV5Compatible');
    await configManager.updateConfig('app:isV5Compatible', true);

    // The `try` opens right here: this worker's database is shared with every other file
    // it runs, so the flag has to be put back however this case ends.
    try {
      let finishNormalization: () => void = () => {};
      normalizeAllPublicPages.mockReturnValue(
        new Promise<void>((resolve) => {
          finishNormalization = resolve;
        }),
      );

      await fs.writeFile(path.join(importsDir, PAGES_JSON), '[]');

      const running = importService.import(
        ['pages'],
        new Map([['pages', buildImportSettings(PAGES_JSON)]]),
      );

      await vi.waitFor(() =>
        expect(normalizeAllPublicPages).toHaveBeenCalledOnce(),
      );

      expect(terminateCount).toBe(0);
      // The same window seen from the other side: getStatus() is what the status endpoint
      // answers with, and it has to agree that the import is still running.
      expect((await importService.getStatus()).isImporting).toBe(true);

      finishNormalization();
      await running;

      expect(terminateCount).toBe(1);
      expect((await importService.getStatus()).isImporting).toBe(false);
    } finally {
      await configManager.updateConfig(
        'app:isV5Compatible',
        originalIsV5Compatible,
        { removeIfUndefined: true },
      );
    }
  });
});
