/**
 * What a legacy ("add to the existing data") transfer must still do after the migration
 * preset was added to the receiving side (task 11.2, requirements 6.1, 6.2, 5.3, 5.4).
 *
 * The receive route now runs a whole procedure around the import — it can close the
 * destination, rescue its administrators, invalidate sessions and put settings back — and
 * every one of those steps starts on a condition of its own. This file is the one that
 * fails when a condition is widened: it drives transfers that a legacy operator can build
 * today and asserts that the destination is left exactly as it used to be.
 *
 * The case worth naming is the one that replaces `pages`: a legacy transfer may
 * legitimately do that (`MODE_RESTRICTED_COLLECTION.pages` offers it), so a transfer of
 * "replace `pages`, append everything else" is a shape an operator really sends. Deciding
 * whether to close the destination by subtracting only `FORCED_MODE_COLLECTIONS`
 * (`configs`) instead of `COLLECTIONS_EXCLUDED_FROM_COHERENCE` (`configs` and `pages`)
 * would put that transfer's destination into maintenance mode, and deciding whether to
 * rescue by "something is replaced" instead of "`users` is replaced" would try to
 * re-insert administrators that were never removed and report a finished transfer as
 * failed. Neither shows up anywhere else in the suite.
 *
 * The maintenance-mode flag, the site URL and the file upload type are always read back
 * **from the database with the raw driver**. `isMaintenanceMode()` and `getConfig()` serve
 * an in-memory copy that the import's raw-driver writes never touch, so an assertion made
 * through them stays green even when the database says something else.
 *
 * Replacing `pages` empties that whole collection, hence the `.exclusive.` file name
 * (see vitest.workspace.mts).
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
import { UserStatus } from '~/server/models/user/conts';
import { G2G_DATA_CONFLICT_ERROR_CODE } from '~/server/models/vo/g2g-transfer-error';
import AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  type G2GTransferPusherService,
  G2GTransferReceiverService,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import {
  getImportService,
  initializeImportService,
} from '~/server/service/import';
import { getGrowiVersion } from '~/utils/growi-version';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

/** Every fixture this file writes carries it, so the clean-up can find them all. */
const FIXTURE_PREFIX = 'g2g-nonreg-';

/**
 * The destination's administrator. It has a password and is active, so it is an account
 * the rescue would pick up — which is what makes "nobody was rescued" an assertion about
 * the starting condition rather than about an empty destination.
 */
const DEST_ADMIN = {
  _id: '0123456789abcdef015b0001',
  username: `${FIXTURE_PREFIX}admin`,
  email: `${FIXTURE_PREFIX}admin@example.com`,
  password: 'g2g-nonreg-destination-password-hash',
} as const;

/** An ordinary destination user; a legacy transfer must leave it alone. */
const DEST_MEMBER = {
  _id: '0123456789abcdef015b0002',
  username: `${FIXTURE_PREFIX}member`,
  email: `${FIXTURE_PREFIX}member@example.com`,
} as const;

/** The page the destination already holds, and that replacing `pages` removes. */
const DEST_PAGE = {
  _id: '0123456789abcdef015b0003',
  path: `/${FIXTURE_PREFIX}destination-page`,
} as const;

const OPERATOR_USER_ID = '0123456789abcdef015b0004';

/** The name the rescue would have given the destination's administrator, had it run. */
const RESCUED_USERNAME = `${DEST_ADMIN.username}-rescued`;

/** An incoming user that collides with nothing: appended alongside the destination's own. */
const ARCHIVE_USER = {
  _id: '0123456789abcdef015b0010',
  username: `${FIXTURE_PREFIX}newcomer`,
  email: `${FIXTURE_PREFIX}newcomer@example.com`,
  status: UserStatus.STATUS_ACTIVE,
} as const;

const ARCHIVE_PAGE = {
  _id: '0123456789abcdef015b0011',
  path: `/${FIXTURE_PREFIX}source-page`,
} as const;

/**
 * Takes the destination administrator's e-mail address. Appended rather than replaced, so
 * the unique index really would be violated — the conflict a legacy transfer has to be
 * refused over (requirement 6.2).
 */
const COLLIDING_USER = {
  _id: '0123456789abcdef015b0012',
  username: `${FIXTURE_PREFIX}colliding`,
  email: DEST_ADMIN.email,
  status: UserStatus.STATUS_ACTIVE,
} as const;

/**
 * Collides with nothing. This is the document a partially-applied import writes while
 * dropping the colliding one — issue #10151 — so its absence is what says the import
 * never started, rather than merely that the collision was caught.
 */
const CLEAN_USER = {
  _id: '0123456789abcdef015b0013',
  username: `${FIXTURE_PREFIX}clean`,
  email: `${FIXTURE_PREFIX}clean@example.com`,
  status: UserStatus.STATUS_ACTIVE,
} as const;

const DESTINATION_SITE_URL = 'http://g2g-nonreg-destination.example.com';
const DESTINATION_FILE_UPLOAD_TYPE = 'local';

/**
 * What the source sends alongside the archive. Deliberately different from the
 * destination's own storage setting: requirement 5.3 is only observable when applying the
 * source's configs would show.
 */
const SOURCE_UPLOAD_CONFIGS = { 'app:fileUploadType': 'aws' } as const;

/**
 * The extra flags a `pages` entry has to carry: the receiving side's overwrite-params
 * generation decides eligibility by whether `isOverwriteAuthorWithCurrentUser` exists on
 * the option at all, and throws `Invalid option for pages` when it does not.
 */
const PAGE_IMPORT_OPTION_FLAGS = {
  isOverwriteAuthorWithCurrentUser: false,
  makePublicForGrant2: false,
  makePublicForGrant4: false,
  makePublicForGrant5: false,
  initPageMetadatas: false,
} as const;

const SNAPSHOT_COLLECTIONS = ['users', 'pages'] as const;

type ArchiveEntry = { name: string; content: string };

describe('receive route POST / — a legacy transfer leaves the destination as it found it', () => {
  let app: express.Application;
  let User: Model<IUser>;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;

  const pagesCollection = () => mongoose.connection.collection('pages');

  const writeArchiveZip = async (
    zipName: string,
    entries: readonly ArchiveEntry[],
  ): Promise<string> => {
    const zipPath = path.join(tmpDir, zipName);
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
    for (const { name, content } of entries) {
      archive.append(content, { name });
    }
    await archive.finalize();
    await written;

    return zipPath;
  };

  const postArchive = (
    zipPath: string,
    collections: readonly string[],
    optionsMap: Record<string, { mode: ImportMode }>,
  ): request.Test =>
    request(app)
      .post('/')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue)
      .field('collections', JSON.stringify(collections))
      .field('optionsMap', JSON.stringify(optionsMap))
      .field('operatorUserId', OPERATOR_USER_ID)
      .field('uploadConfigs', JSON.stringify(SOURCE_UPLOAD_CONFIGS))
      .attach('transferDataZipFile', zipPath);

  /**
   * "Replace `pages`, append `users`" — the shape a legacy operator can build today, and
   * the one whose destination must not be closed and whose administrators must not be
   * rescued.
   */
  const postReplacingPages = async (
    zipName: string,
    usersJson: string,
  ): Promise<request.Response> => {
    const zipPath = await writeArchiveZip(zipName, [
      { name: 'users.json', content: usersJson },
      { name: 'pages.json', content: JSON.stringify([ARCHIVE_PAGE]) },
    ]);

    return postArchive(zipPath, ['users', 'pages'], {
      users: { mode: ImportMode.insert },
      pages: { mode: ImportMode.flushAndInsert, ...PAGE_IMPORT_OPTION_FLAGS },
    });
  };

  /** Straight from the collection, past every in-memory copy. */
  const readConfigFromDb = async (key: string): Promise<unknown> => {
    const doc = await mongoose.connection
      .collection('configs')
      .findOne({ key });
    return doc == null ? undefined : JSON.parse(doc.value);
  };

  const readMaintenanceModeFromDb = (): Promise<unknown> =>
    readConfigFromDb('app:isMaintenanceMode');

  // Whole-collection snapshots (raw driver reads), the same style `g2g-transfer.integ.ts`
  // uses to prove that a refused transfer wrote nothing.
  const snapshotDestination = async (): Promise<unknown> => {
    const snapshots = await Promise.all(
      SNAPSHOT_COLLECTIONS.map((collectionName) =>
        mongoose.connection
          .collection(collectionName)
          .find({})
          .sort({ _id: 1 })
          .toArray(),
      ),
    );
    return Object.fromEntries(
      SNAPSHOT_COLLECTIONS.map((collectionName, i) => [
        collectionName,
        snapshots[i],
      ]),
    );
  };

  /**
   * By the fixture prefix rather than by `_id`: a document left behind by an interrupted
   * run carries the same unique fields under a different `_id`, and deleting by `_id`
   * alone would leave it to collide with this run's insertion.
   */
  const removeFixtures = async (): Promise<void> => {
    const prefixed = new RegExp(`^${FIXTURE_PREFIX}`);

    await User.deleteMany({
      $or: [{ username: prefixed }, { email: prefixed }],
    });
    await pagesCollection().deleteMany({
      path: new RegExp(`^/${FIXTURE_PREFIX}`),
    });

    // `recursive`/`force` because the clean-up is the one thing that has to survive a bad
    // state: today's archives unpack to flat JSON, but a plain `rm` would throw on a
    // directory or on an entry that vanished between the listing and the removal, and
    // leave the rest of the leftovers in place.
    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) =>
        fs.rm(path.join(importsDir, fileName), {
          recursive: true,
          force: true,
        }),
      ),
    );
  };

  /** The destination as it stood before the transfer. */
  const createFixtures = async (): Promise<void> => {
    await User.create([
      {
        _id: DEST_ADMIN._id,
        username: DEST_ADMIN.username,
        email: DEST_ADMIN.email,
        password: DEST_ADMIN.password,
        admin: true,
        status: UserStatus.STATUS_ACTIVE,
      },
      {
        _id: DEST_MEMBER._id,
        username: DEST_MEMBER.username,
        email: DEST_MEMBER.email,
        status: UserStatus.STATUS_ACTIVE,
      },
    ]);
    await pagesCollection().insertOne({
      _id: new mongoose.Types.ObjectId(DEST_PAGE._id),
      path: DEST_PAGE.path,
    });

    await configManager.updateConfigs({
      'app:isMaintenanceMode': false,
      'app:siteUrl': DESTINATION_SITE_URL,
      'app:fileUploadType': DESTINATION_FILE_UPLOAD_TYPE,
    });
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-legacy-nonreg-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    const crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      // Stubbed on purpose: importing `pages` runs the v5 normalization after the import
      // loop on a v5-compatible GROWI, and this file is about what happens around the
      // import rather than about the normalization itself.
      pageService: { normalizeAllPublicPages: vi.fn() },
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    // The real one, not a stub: this file's subject is what the transfer does to the flag
    // in the database, and a stubbed `startMaintenanceMode` could never put it there — so
    // a procedure that wrongly closed the destination would go unnoticed.
    crowi.appService = new AppService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const keyString = await receiverService.createTransferKey(
      'http://g2g-nonreg-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    // Also before the first test, not only between them: this database outlives the run,
    // so a document from an earlier, separately-run process would otherwise survive into
    // the first Arrange and fail its insertion.
    await removeFixtures();
  }, 120_000);

  beforeEach(async () => {
    await createFixtures();
  });

  afterEach(async () => {
    // `clearMocks` only forgets the calls; a spy left in place would follow this file's
    // remaining tests into the next one.
    vi.restoreAllMocks();
    await removeFixtures();
    // Put back what the next test in this exclusive-database project expects to find:
    // these tests move the flag on purpose and the transfer rewrites the upload settings.
    await configManager.updateConfigs({
      'app:isMaintenanceMode': false,
      'app:siteUrl': DESTINATION_SITE_URL,
      'app:fileUploadType': DESTINATION_FILE_UPLOAD_TYPE,
    });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('refuses a transfer whose appended collection collides, and imports nothing — not even the collection it was going to replace', async () => {
    // Requirement 6.2: the conflict gate still stops a legacy transfer. What is new here
    // is the collection alongside it — detection skips `pages` because replacing it can
    // never collide, and skipping it must not turn into importing it.
    const before = await snapshotDestination();

    const response = await postReplacingPages(
      'g2g-nonreg-conflict.growi.zip',
      JSON.stringify([COLLIDING_USER, CLEAN_USER]),
    );

    expect(response.status).toBe(409);
    expect(response.body.errors[0].code).toBe(G2G_DATA_CONFLICT_ERROR_CODE);
    expect(response.body.errors[0].message).toContain(DEST_ADMIN.email);

    // Nothing was written: not the colliding document (which would have failed anyway),
    // and not the clean one (which is what the gate is for).
    expect(await User.findById(COLLIDING_USER._id)).toBeNull();
    expect(await User.findById(CLEAN_USER._id)).toBeNull();
    // …and nothing was removed either: `pages` was the transfer's replace target, so an
    // import that started at all would have emptied it before writing a single document.
    expect(
      await pagesCollection().findOne({
        _id: new mongoose.Types.ObjectId(DEST_PAGE._id),
      }),
    ).not.toBeNull();
    expect(
      await pagesCollection().findOne({
        _id: new mongoose.Types.ObjectId(ARCHIVE_PAGE._id),
      }),
    ).toBeNull();
    expect(await snapshotDestination()).toEqual(before);

    // A refused transfer never reaches the procedure that could close the destination.
    expect(await readMaintenanceModeFromDb()).toBe(false);
  });

  test('replaces pages and appends users without rescuing anybody, closing the destination, or changing its own settings', async () => {
    // Read the moment the import starts, which is the only way to tell "the destination
    // was closed for the duration" from "it was closed and opened again": the clean-up
    // restores the flag to what it was, so the state afterwards is the same either way.
    //
    // Not the only detector, and deliberately so: `maintenanceModeReleased` in the
    // response body (asserted below) goes red on the same regression by itself — the
    // procedure can only report having released the flag if it raised it first. Neither
    // assertion is a duplicate of the other, and this file does not rest on the spy: keep
    // both, so removing one leaves requirement 6.1 still guarded.
    let maintenanceModeWhenImportStarted: unknown;
    const importService = getImportService();
    const importOriginal = importService.import.bind(importService);
    vi.spyOn(importService, 'import').mockImplementation(async (...args) => {
      maintenanceModeWhenImportStarted = await readMaintenanceModeFromDb();
      return importOriginal(...args);
    });

    const response = await postReplacingPages(
      'g2g-nonreg-replace-pages.growi.zip',
      JSON.stringify([ARCHIVE_USER]),
    );

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);
    expect(response.body.importAborted).toBe(false);

    // The transfer really ran, so everything below is about a completed transfer rather
    // than about one that never started: `pages` was emptied and refilled from the
    // archive, while `users` was added to.
    expect(
      await pagesCollection().findOne({
        _id: new mongoose.Types.ObjectId(DEST_PAGE._id),
      }),
    ).toBeNull();
    const importedPage = await pagesCollection().findOne({
      _id: new mongoose.Types.ObjectId(ARCHIVE_PAGE._id),
    });
    expect(importedPage?.path).toBe(ARCHIVE_PAGE.path);
    const importedUser = await User.findById(ARCHIVE_USER._id);
    expect(importedUser?.username).toBe(ARCHIVE_USER.username);

    // Requirement 6.1: the destination's own accounts were appended to, not replaced.
    const untouchedAdmin = await User.findById(DEST_ADMIN._id).lean<{
      username?: string;
      email?: string;
    } | null>();
    expect(untouchedAdmin?.username).toBe(DEST_ADMIN.username);
    expect(untouchedAdmin?.email).toBe(DEST_ADMIN.email);
    expect(await User.findById(DEST_MEMBER._id)).not.toBeNull();

    // The destination was never taken away from its users — not while the import ran, and
    // not afterwards. `pages` is a collection a legacy operator may replace, so deciding
    // to close on "something is replaced" minus `configs` alone would close this one.
    expect(maintenanceModeWhenImportStarted).toBe(false);
    expect(await readMaintenanceModeFromDb()).toBe(false);
    // Never released either: the procedure did not touch the flag at all, which is what
    // separates "left open" from "closed and reopened".
    expect(response.body.maintenanceModeReleased).toBe(false);

    // Nobody was rescued. `users` was appended to, so the destination's administrators
    // were never removed: a rescue here would try to re-insert accounts that are still
    // there, fail on their `_id` and `username`, and report this finished transfer as a
    // failed one (requirements 6.1, 4.1).
    expect(response.body.rescue).toBeNull();
    expect(response.body.rescueApplied).toBe(false);
    expect(response.body.postProcessFailures).toEqual([]);
    expect(await User.findOne({ username: RESCUED_USERNAME })).toBeNull();

    // Requirements 5.3 and 5.4: the destination keeps its own address and goes on storing
    // files where it stored them, rather than taking the values the source sent.
    //
    // The site-URL half is weaker than it reads, and worth being plain about: this
    // transfer carries no `configs`, so nothing would write `app:siteUrl` even if the
    // restoration step were deleted outright — all this catches is a regression that
    // writes the *source's* address. Requirement 5.4 is really held down by
    // `g2g-transfer-replace-procedure.exclusive.integ.ts` ("keeps the destination's site
    // URL and file upload settings across an import of configs"), whose archive ships a
    // different `app:siteUrl` and so fails when the restoration goes missing.
    //
    // The upload-settings half below is not weak in the same way: the source really does
    // send a different `app:fileUploadType`, so a procedure that applied the source's
    // upload configs to this destination would fail here.
    expect(await readConfigFromDb('app:siteUrl')).toBe(DESTINATION_SITE_URL);
    expect(await readConfigFromDb('app:fileUploadType')).toBe(
      DESTINATION_FILE_UPLOAD_TYPE,
    );
    expect(await readConfigFromDb('app:fileUploadType')).not.toBe(
      SOURCE_UPLOAD_CONFIGS['app:fileUploadType'],
    );
  });

  test.each([
    false,
    true,
  ])('leaves the maintenance-mode flag exactly as it found it (%s)', async (maintenanceModeBefore) => {
    await configManager.updateConfig(
      'app:isMaintenanceMode',
      maintenanceModeBefore,
    );

    const zipPath = await writeArchiveZip(
      `g2g-nonreg-flag-${maintenanceModeBefore}.growi.zip`,
      [{ name: 'users.json', content: JSON.stringify([ARCHIVE_USER]) }],
    );

    const response = await postArchive(zipPath, ['users'], {
      users: { mode: ImportMode.insert },
    });

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);
    // The transfer completed, so the flag below was read after a real import.
    expect(await User.findById(ARCHIVE_USER._id)).not.toBeNull();

    // A transfer that replaces nothing has no reason to close the destination, and no
    // right to open one its own administrator had closed (requirement 6.1). This
    // transfer carries no `configs`, so requirement 2.9's "a GROWI running on someone
    // else's settings stays closed" does not apply either.
    expect(await readMaintenanceModeFromDb()).toBe(maintenanceModeBefore);
    expect(response.body.maintenanceModeReleased).toBe(false);
    expect(response.body.rescue).toBeNull();
  });
});
