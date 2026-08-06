/**
 * Importing the configs collection must not take the maintenance-mode flag with it
 * (requirement 2.4).
 *
 * `app:isMaintenanceMode` is a row in the configs collection, and that collection is
 * always imported by replacement — every row is deleted before the source's rows are
 * written. GROWI asks the operator to switch maintenance mode on before a manual import
 * and then deletes the very flag that enforces it, and a G2G transfer that protects the
 * destination the same way loses that protection halfway through.
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
 * What the source GROWI's configs.json holds. The source's own flag is always set to the
 * opposite of the destination's, so that "the destination kept its own value" can never
 * be confused with "the source happened to carry the same value".
 */
const buildSourceConfigs = (sourceMaintenanceMode: boolean) => [
  {
    _id: '0123456789abcdef01440001',
    key: 'app:title',
    value: JSON.stringify('imported from the source'),
  },
  {
    _id: '0123456789abcdef01440002',
    key: 'app:isMaintenanceMode',
    value: JSON.stringify(sourceMaintenanceMode),
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
    // The import emptied the collection, so put the destination's own settings back
    // before the next test decides what "before the import" means.
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
  ])('is still %s in the database after importing configs', async (isMaintenanceModeBeforeImport) => {
    await configManager.updateConfig(
      'app:isMaintenanceMode',
      isMaintenanceModeBeforeImport,
    );
    await writeConfigsJson(
      JSON.stringify(buildSourceConfigs(!isMaintenanceModeBeforeImport)),
    );

    await importConfigs();

    // Not the source's value, and not a hard-coded `true` either: a transfer into a
    // destination that was running normally would otherwise be left in maintenance
    // mode with nobody to switch it off.
    expect(await readMaintenanceModeFromDb()).toBe(
      isMaintenanceModeBeforeImport,
    );
    // The rest of the source's configs really did arrive, so the assertion above is
    // about the flag rather than about an import that never ran.
    const title = await mongoose.connection
      .collection('configs')
      .findOne({ key: 'app:title' });
    expect(title).not.toBeNull();
  });

  test('is written back even when importing configs fails', async () => {
    await configManager.updateConfig('app:isMaintenanceMode', true);
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
