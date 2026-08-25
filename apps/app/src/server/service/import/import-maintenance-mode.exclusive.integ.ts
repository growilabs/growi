/**
 * Importing the configs collection leaves this GROWI in maintenance mode
 * (requirement 2.4).
 *
 * `app:isMaintenanceMode` is a row in the configs collection, and that collection is
 * always imported by replacement — every row is deleted before the archive's are written.
 * So an import replaces every setting this GROWI has with someone else's, and takes the
 * flag that keeps ordinary users out with it. GROWI used to end up open, running on the
 * archive's settings, with (for a transfer) not one attachment delivered yet.
 *
 * The import therefore closes it, and nothing here reopens it: the operator is told
 * beforehand that they will have to switch maintenance mode off themselves.
 *
 * These tests read the flag back **from the database with the raw driver**. Asking
 * `isMaintenanceMode()` would prove nothing: it serves an in-memory copy that the
 * import's raw-driver writes never touch, so it keeps answering with the pre-import value
 * even when the row is gone — the assertion would stay green with the write-back deleted.
 *
 * They empty the configs collection, hence the `.exclusive.` file name.
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

const CONFIGS_JSON = 'configs.json';

/**
 * What the archive's configs.json holds. Its own flag is `false`, so that a `true` in the
 * database afterwards can only have come from the import putting it there — never from
 * the archive, and never from what the destination happened to hold before.
 */
const SOURCE_CONFIGS = [
  {
    _id: '0123456789abcdef01440001',
    key: 'app:title',
    value: JSON.stringify('imported from the source'),
  },
  {
    _id: '0123456789abcdef01440002',
    key: 'app:isMaintenanceMode',
    value: JSON.stringify(false),
  },
];

describe('ImportService.import — the maintenance mode flag', () => {
  let importService: ImportService;
  let tmpDir: string;
  let importsDir: string;

  /** Reads the flag straight out of the collection, bypassing every in-memory copy. */
  const readMaintenanceModeFromDb = async (): Promise<unknown> => {
    const doc = await mongoose.connection
      .collection('configs')
      .findOne({ key: 'app:isMaintenanceMode' });
    return doc == null ? undefined : JSON.parse(doc.value);
  };

  const writeConfigsJson = async (content: string): Promise<void> => {
    await fs.writeFile(path.join(importsDir, CONFIGS_JSON), content);
  };

  const importConfigs = (): Promise<unknown> => {
    const importSettings: ImportSettings = {
      mode: ImportMode.flushAndInsert,
      jsonFileName: CONFIGS_JSON,
      overwriteParams: {},
    };
    return importService.import(
      ['configs'],
      new Map([['configs', importSettings]]),
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-maintenance-'));
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
    // The import emptied the collection and left maintenance mode on, so put the
    // destination's own settings back before the next test arranges its own.
    await configManager.updateConfig('app:isMaintenanceMode', false);
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test.each([
    true,
    false,
  ])('is true in the database afterwards, whether or not it was set before (%s)', async (isMaintenanceModeBeforeImport) => {
    await configManager.updateConfig(
      'app:isMaintenanceMode',
      isMaintenanceModeBeforeImport,
    );
    await writeConfigsJson(JSON.stringify(SOURCE_CONFIGS));

    await importConfigs();

    // The archive says `false` and, in one of these two runs, so did the destination.
    // Only the import can be the reason it is `true`.
    expect(await readMaintenanceModeFromDb()).toBe(true);
    // The rest of the archive's configs really did arrive, so the assertion above is
    // about the flag rather than about an import that never ran.
    const title = await mongoose.connection
      .collection('configs')
      .findOne({ key: 'app:title' });
    expect(title).not.toBeNull();
  });

  test('is set even when importing configs fails', async () => {
    await configManager.updateConfig('app:isMaintenanceMode', false);
    // A closing bracket where the parser expects a value: the read throws part-way
    // through the pipeline, after `deleteMany` has already emptied the collection. A file
    // that simply does not exist fails earlier than that and never gets near the flag, so
    // it would prove nothing here — and the malformed shapes the streaming parser accepts
    // in silence (an unterminated array, a missing value) would not fail at all.
    await writeConfigsJson('[{"a":]}]');

    // Whether the failure surfaces to the caller is a separate concern; here it is only
    // the arrangement.
    await importConfigs().catch(() => {});

    expect(await readMaintenanceModeFromDb()).toBe(true);
  });
});
