/**
 * Route-level integration test for the two places that keep a non-transferable collection
 * out of a transfer (requirements 5.1, 5.6, 5.8, 6.3).
 *
 * The push route drops those collections from the request before the archive is built,
 * and the receive route refuses a request that still names one. Both are exercised
 * through the real router over HTTP, and what the destination holds afterwards is read
 * back from the database rather than from a spy — the point of the declaration is that
 * the transfer key the transfer itself runs on, and the record of which migration scripts
 * the destination has applied, survive a transfer that selected every collection.
 */

import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser } from '@growi/core';
import archiver from 'archiver';
import express from 'express';
import mongoose, { type Model } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import { G2G_PROTECTED_COLLECTION_ERROR_CODE } from '~/server/models/vo/g2g-transfer-error';
import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  type G2GTransferPusherService,
  G2GTransferReceiverService,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import { NON_TRANSFERABLE_COLLECTIONS } from '~/server/service/import/non-transferable-collections';
import { getGrowiVersion } from '~/utils/growi-version';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import { setup as setupMongoRouter } from './mongo';
import addCustomFunctionToResponse from './response';

const CLEAN_USER = {
  _id: '0123456789abcdef01420001',
  username: 'g2g-protected-clean-user',
  email: 'g2g-protected-clean-user@example.com',
} as const;

const OPERATOR_USER_ID = '0123456789abcdef01420002';

const ADMIN_USER = {
  _id: '0123456789abcdef01420003',
  admin: true,
  status: 2, // UserStatus.STATUS_ACTIVE — what loginRequiredStrictly checks for
} as const;

const USERS_JSON = 'users.json';
const TRANSFER_KEYS_JSON = 'transferkeys.json';
const ZIP_NAME = 'g2g-protected-transfer.zip';

/** The two collections requirement 5.1 names: the running transfer and the migration log. */
const PROTECTED_COLLECTIONS = ['transferkeys', 'migrations'] as const;

describe('non-transferable collections at the transfer routes', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let receiverService: G2GTransferReceiverService;
  let pusherService: G2GTransferPusherService;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyString: string;
  let transferKeyValue: string;

  const writeArchiveZip = async (
    entries: Readonly<Record<string, string>>,
  ): Promise<string> => {
    const zipPath = path.join(tmpDir, ZIP_NAME);
    const archive = archiver('zip');
    const output = createWriteStream(zipPath);
    const written = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(output);
    archive.append(JSON.stringify({ version: getGrowiVersion() }), {
      name: 'meta.json',
    });
    for (const [name, content] of Object.entries(entries)) {
      archive.append(content, { name });
    }
    await archive.finalize();
    await written;

    return zipPath;
  };

  const snapshotProtectedCollections = async (): Promise<unknown> => {
    const snapshots = await Promise.all(
      PROTECTED_COLLECTIONS.map((collectionName) =>
        mongoose.connection
          .collection(collectionName)
          .find({})
          .sort({ _id: 1 })
          .toArray(),
      ),
    );
    return Object.fromEntries(
      PROTECTED_COLLECTIONS.map((collectionName, i) => [
        collectionName,
        // `expireAt` is left out: every request that authenticates with a transfer key
        // pushes it forward on purpose, so that a transfer outlasting the key's lifetime
        // still finishes. What must not change is the key itself.
        snapshots[i].map(({ expireAt: _expireAt, ...rest }) => rest),
      ]),
    );
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({ _id: CLEAN_USER._id });
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      // `{ force: true }`: the server's own `finally` block (g2g-transfer.ts)
      // may have already deleted the same file by the time this runs, which
      // is not an error here either (see #11722).
      leftovers.map((fileName) =>
        fs.rm(path.join(importsDir, fileName), { force: true }),
      ),
    );
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-protected-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      appService: mock<AppService>(),
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');

    receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    // The push route's only job here is what it hands to startTransfer, so the pusher is
    // a mock: a real one would try to reach a destination GROWI over the network.
    pusherService = mock<G2GTransferPusherService>();
    crowi.g2gTransferPusherService = pusherService;

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    // The push route takes a JSON body; production mounts the parser app-wide.
    app.use(express.json());
    // The push route sits behind loginRequiredStrictly + adminRequired, and both read
    // req.user only. Nothing in this test depends on how that user got there.
    app.use((req, _res, next) => {
      (req as express.Request & { user: unknown }).user = ADMIN_USER;
      next();
    });
    app.use(setup(crowi));
    // The backup export screen reads this one; the transfer must not have narrowed it.
    app.use('/mongo', setupMongoRouter(crowi));

    transferKeyString = await receiverService.createTransferKey(
      'http://g2g-protected-source.example.com',
    );
    transferKeyValue = TransferKey.parse(transferKeyString).key;

    await removeFixtures();
  }, 120_000);

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('push route GET /transferable-collections', () => {
    test('offers the admin screen only the collections a transfer may carry', async () => {
      const response = await request(app).get('/transferable-collections');

      expect(response.status).toBe(200);
      const { collections } = response.body;

      // The screen selects everything it is offered, so anything listed here is
      // something the transfer would try to carry.
      expect(collections).toEqual(expect.arrayContaining(['users']));
      expect(
        collections.filter((name: string) =>
          NON_TRANSFERABLE_COLLECTIONS.has(name),
        ),
      ).toEqual([]);
      // beforeAll created a transfer key, so this collection really is in the database
      // and its absence above is a decision rather than an accident.
      expect(collections).not.toContain('transferkeys');
    });

    test('does not narrow the list the backup export screen reads', async () => {
      // /mongo/collections serves a different purpose — everything that is safe to put
      // in a backup — and taking the transfer's declaration to it would remove choices
      // from a feature this spec does not touch (requirement 5.7).
      const response = await request(app).get('/mongo/collections');

      expect(response.status).toBe(200);
      expect(response.body.collections).toContain('transferkeys');
    });
  });

  describe('push route POST /transfer', () => {
    test('starts the transfer without the protected collections the operator selected', async () => {
      // The admin screen selects every collection by default, so this is the ordinary
      // request, not an edge case (requirement 5.8).
      vi.mocked(pusherService.getTransferability).mockResolvedValue({
        canTransfer: true,
      });

      const response = await request(app)
        .post('/transfer')
        .send({
          transferKey: transferKeyString,
          collections: ['users', 'transferkeys', 'pages', 'migrations'],
          optionsMap: {
            users: { mode: ImportMode.insert },
            transferkeys: { mode: ImportMode.insert },
            pages: { mode: ImportMode.upsert },
            migrations: { mode: ImportMode.insert },
          },
        });

      expect(response.status).toBe(200);

      // The whole transfer still runs — dropping a collection must not fail the request.
      expect(pusherService.startTransfer).toHaveBeenCalledTimes(1);
      const [, , collections, optionsMap] = vi.mocked(
        pusherService.startTransfer,
      ).mock.calls[0];

      expect(collections).toEqual(['users', 'pages']);
      // The options have to go with the collections: an option left behind for a
      // collection that is no longer transferred is a mode the destination still has to
      // reconcile.
      expect(Object.keys(optionsMap).sort()).toEqual(['pages', 'users']);
    });
  });

  describe('receive route POST /', () => {
    test('refuses a request naming a protected collection and leaves the destination alone', async () => {
      const zipPath = await writeArchiveZip({
        [USERS_JSON]: JSON.stringify([CLEAN_USER]),
        [TRANSFER_KEYS_JSON]: JSON.stringify([]),
      });

      const before = await snapshotProtectedCollections();

      const response = await request(app)
        .post('/')
        .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
        .field('collections', JSON.stringify(['users', 'transferkeys']))
        .field(
          'optionsMap',
          JSON.stringify({
            users: { mode: ImportMode.insert },
            transferkeys: { mode: ImportMode.insert },
          }),
        )
        .field('operatorUserId', OPERATOR_USER_ID)
        .field('uploadConfigs', JSON.stringify({}))
        .attach('transferDataZipFile', zipPath);

      expect(response.status).toBe(400);
      expect(response.body.errors[0].code).toBe(
        G2G_PROTECTED_COLLECTION_ERROR_CODE,
      );
      expect(response.body.errors[0].message).toContain('transferkeys');

      // Nothing was imported: not the protected collection, and not the clean one that
      // shared the request either.
      expect(await User.findById(CLEAN_USER._id)).toBeNull();
      expect(await snapshotProtectedCollections()).toEqual(before);
      // The key this transfer is running on is still usable.
      await expect(
        receiverService.validateTransferKey(transferKeyValue),
      ).resolves.toBeUndefined();
    });
  });
});
