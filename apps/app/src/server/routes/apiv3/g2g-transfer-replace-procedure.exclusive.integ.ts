/**
 * What the receiving side does *around* the import when a transfer replaces collections
 * (task 9.3): protect the destination, rescue its administrators, invalidate the sessions
 * of the users that were replaced, put the destination's own settings back, and decide
 * whether the destination may be opened again.
 *
 * Every assertion here is made through the receive route, because the pieces only mean
 * anything together: the snapshot has to be taken before the import, the rescue has to
 * survive an import that failed halfway, and the answer the source reads is the response
 * body — the two GROWIs are separate processes, so nothing else crosses.
 *
 * The maintenance-mode flag is always read **back from the database with the raw driver**.
 * `isMaintenanceMode()` serves an in-memory copy that the import's raw-driver writes never
 * touch, so an assertion made through it stays green even when the flag is gone from the
 * database (the same trap `import-maintenance-mode.exclusive.integ.ts` documents).
 *
 * These tests empty `users`, `accesstokens` and `configs`, hence the `.exclusive.` file
 * name (see vitest.workspace.mts).
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

import type { SessionConfig } from '~/interfaces/session-config';
import { ImportMode } from '~/models/admin/import-mode';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import { AccessToken } from '~/server/models/access-token';
import { UserStatus } from '~/server/models/user/conts';
import AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import {
  type G2GTransferPusherService,
  G2GTransferReceiverService,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import type { StoredSessionDocument } from '~/server/service/g2g-transfer-session-invalidation';
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
const FIXTURE_PREFIX = 'g2g-proc-';

/**
 * The destination's own administrator: the account the rescue exists for. Its password
 * hash and its access token are what requirements 4.2 and 4.9 promise will still work.
 */
const DEST_ADMIN = {
  _id: '0123456789abcdef014b0001',
  username: `${FIXTURE_PREFIX}admin`,
  email: `${FIXTURE_PREFIX}admin@example.com`,
  password: 'g2g-proc-destination-password-hash',
  apiToken: 'g2g-proc-destination-api-token',
} as const;

/** An ordinary destination user: replaced, not rescued, and logged out with it. */
const DEST_MEMBER = {
  _id: '0123456789abcdef014b0002',
  username: `${FIXTURE_PREFIX}member`,
  email: `${FIXTURE_PREFIX}member@example.com`,
} as const;

const DEST_ADMIN_TOKEN = {
  _id: '0123456789abcdef014b0003',
  tokenHash: `${FIXTURE_PREFIX}token-hash`,
} as const;

/**
 * The incoming administrator, taking both the destination administrator's `username` and
 * its `email`: the ordinary migration situation, where the same person runs both GROWIs.
 */
const ARCHIVE_ADMIN = {
  _id: '0123456789abcdef014b0010',
  username: DEST_ADMIN.username,
  email: DEST_ADMIN.email,
  password: 'g2g-proc-source-password-hash',
  admin: true,
  status: UserStatus.STATUS_ACTIVE,
} as const;

/** An incoming user that collides with nothing, for the merge-shaped transfer. */
const ARCHIVE_NEWCOMER = {
  _id: '0123456789abcdef014b0011',
  username: `${FIXTURE_PREFIX}newcomer`,
  email: `${FIXTURE_PREFIX}newcomer@example.com`,
  status: UserStatus.STATUS_ACTIVE,
} as const;

const RESCUED_USERNAME = `${DEST_ADMIN.username}-rescued`;

const OPERATOR_USER_ID = '0123456789abcdef014b0004';

const DESTINATION_SITE_URL = 'http://g2g-proc-destination.example.com';
const SOURCE_SITE_URL = 'http://g2g-proc-source.example.com';
const DESTINATION_FILE_UPLOAD_TYPE = 'local';
const SOURCE_FILE_UPLOAD_TYPE = 'aws';

/**
 * A JSON file the streaming parser chokes on part-way through, which is what makes one
 * collection's import fail while the others carry on. A merely unterminated array would
 * not do: JSONStream reports neither an error nor a completion for one, it simply stops
 * yielding documents and the read ends normally at EOF.
 */
const UNPARSEABLE_JSON = '[{"a":]}]';

type ArchiveEntry = { name: string; content: string };

describe('receive route POST / — the replace procedure around the import', () => {
  let app: express.Application;
  let crowi: Crowi;
  let User: Model<IUser>;
  let tmpDir: string;
  let importsDir: string;
  let transferKeyValue: string;

  // Typed as `connect-mongo` really stores them: the document id *is* the session id, so
  // it is a string rather than an ObjectId.
  const sessionsCollection = () =>
    mongoose.connection.collection<StoredSessionDocument>('sessions');

  /**
   * A whole `SessionConfig`, written out rather than built with `mock<SessionConfig>()`:
   * that helper replaces the nested `store` with a proxy of its own, and a `collectionP`
   * turned into a mock function is no longer a promise — the store would then be resolved
   * as "cannot select sessions" and nothing would ever be destroyed.
   */
  const buildSessionConfig = (store: unknown): SessionConfig => ({
    rolling: true,
    secret: 'g2g-proc-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 },
    genid: () => 'g2g-proc-session-id',
    store,
  });

  /** A `connect-mongo`-shaped store over the real `sessions` collection. */
  const workingSessionStore = () => ({
    get: () => {},
    set: () => {},
    destroy: () => {},
    collectionP: Promise.resolve(sessionsCollection()),
  });

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
      .field('uploadConfigs', JSON.stringify({}))
      .attach('transferDataZipFile', zipPath);

  /** The whole-collection replacement a migration transfer performs on `users`. */
  const postReplacingUsers = async (
    zipName: string,
    extraEntries: readonly ArchiveEntry[] = [],
    extraCollections: readonly string[] = [],
  ): Promise<request.Response> => {
    const zipPath = await writeArchiveZip(zipName, [
      { name: 'users.json', content: JSON.stringify([ARCHIVE_ADMIN]) },
      { name: 'accesstokens.json', content: JSON.stringify([]) },
      ...extraEntries,
    ]);
    const collections = ['users', 'accesstokens', ...extraCollections];

    return postArchive(
      zipPath,
      collections,
      Object.fromEntries(
        collections.map((name) => [name, { mode: ImportMode.flushAndInsert }]),
      ),
    );
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

  /**
   * By the fixture prefix rather than by `_id`: a document left behind by an interrupted
   * run carries the same unique fields under a different `_id`, and deleting by `_id`
   * alone would leave it to collide with this run's re-insertion.
   */
  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      $or: [
        { username: new RegExp(`^${FIXTURE_PREFIX}`) },
        { email: new RegExp(`^${FIXTURE_PREFIX}`) },
      ],
    });
    await AccessToken.deleteMany({});
    await sessionsCollection().deleteMany({});
    await mongoose.connection.collection('usergrouprelations').deleteMany({});

    const leftovers = await fs.readdir(importsDir);
    await Promise.all(
      leftovers.map((fileName) => fs.rm(path.join(importsDir, fileName))),
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
        apiToken: DEST_ADMIN.apiToken,
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
    await AccessToken.create({
      _id: DEST_ADMIN_TOKEN._id,
      user: DEST_ADMIN._id,
      tokenHash: DEST_ADMIN_TOKEN.tokenHash,
      expiredAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: [],
      description: 'g2g-proc destination token',
    });

    await configManager.updateConfigs({
      'app:isMaintenanceMode': false,
      'app:siteUrl': DESTINATION_SITE_URL,
      'app:fileUploadType': DESTINATION_FILE_UPLOAD_TYPE,
    });

    crowi.sessionConfig = buildSessionConfig(workingSessionStore());
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-replace-procedure-'));
    importsDir = path.join(tmpDir, 'imports');
    await fs.mkdir(importsDir, { recursive: true });

    crowi = mock<Crowi>({
      tmpDir,
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    // The real one, not a stub: this file's subject is what happens to the flag in the
    // database, and a stubbed `startMaintenanceMode` would never put it there.
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
      'http://g2g-proc-source.example.com',
    );
    transferKeyValue = TransferKey.parse(keyString).key;

    // Also before the first test, not only between them: this database outlives the run,
    // so a document from an earlier, separately-run process would otherwise survive into
    // the first Arrange and fail its re-insertion.
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
    // An import that carried `configs` emptied that collection; put back what the next
    // test in this exclusive-database project expects to find.
    await configManager.updateConfigs({
      'app:isMaintenanceMode': false,
      'app:siteUrl': DESTINATION_SITE_URL,
      'app:fileUploadType': DESTINATION_FILE_UPLOAD_TYPE,
    });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('rescues the administrator and keeps the destination closed when a collection fails to import', async () => {
    // Captured the moment the import starts, which is the only way to tell "raised before
    // the import" from "raised after it" — requirement 2.4 is about the window in between.
    let maintenanceModeWhenImportStarted: unknown;
    const importService = getImportService();
    const importOriginal = importService.import.bind(importService);
    vi.spyOn(importService, 'import').mockImplementation(async (...args) => {
      maintenanceModeWhenImportStarted = await readMaintenanceModeFromDb();
      return importOriginal(...args);
    });

    const response = await postReplacingUsers(
      'g2g-proc-partial-failure.growi.zip',
      [{ name: 'usergrouprelations.json', content: UNPARSEABLE_JSON }],
      ['usergrouprelations'],
    );

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual(['usergrouprelations']);

    // The destination was closed before a single document was written (requirement 2.4)…
    expect(maintenanceModeWhenImportStarted).toBe(true);
    // …and stays closed, because part of the import did not make it (requirement 2.8).
    expect(await readMaintenanceModeFromDb()).toBe(true);
    expect(response.body.maintenanceModeReleased).toBe(false);

    // The rescue ran even though the import failed part-way (requirement 4.8).
    expect(response.body.rescueApplied).toBe(true);

    // Checked before the shape below, so that a body carrying the re-insertion payload
    // fails *here*: what the rescue holds as data — the destination administrators'
    // password hashes, their `apiToken`, the hash of every access token — must not travel
    // to the source GROWI and on to the source operator's browser.
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(DEST_ADMIN.password);
    expect(body).not.toContain(DEST_ADMIN.apiToken);
    expect(body).not.toContain(DEST_ADMIN_TOKEN.tokenHash);

    expect(response.body.rescue.rescued).toEqual([
      {
        originalUsername: DEST_ADMIN.username,
        rescuedUsername: RESCUED_USERNAME,
        emailRemoved: true,
        slackMemberIdRemoved: false,
        idReassigned: false,
      },
    ]);

    // The destination's administrator is still there, still an administrator, still with
    // the password hash it had (requirements 4.1, 4.2) and without the e-mail address the
    // incoming user took (requirement 4.5).
    const rescuedAdmin = await User.findOne({
      username: RESCUED_USERNAME,
    }).lean<{ password?: string; email?: string; admin?: boolean } | null>();
    expect(rescuedAdmin).not.toBeNull();
    expect(rescuedAdmin?.password).toBe(DEST_ADMIN.password);
    expect(rescuedAdmin?.admin).toBe(true);
    expect(rescuedAdmin?.email).toBeUndefined();

    // The incoming administrator took the name and the address it came with.
    const importedAdmin = await User.findById(ARCHIVE_ADMIN._id).lean<{
      username?: string;
      email?: string;
    } | null>();
    expect(importedAdmin?.username).toBe(ARCHIVE_ADMIN.username);
    expect(importedAdmin?.email).toBe(ARCHIVE_ADMIN.email);

    // The token that administrator was using is back too (requirement 4.9).
    const restoredToken = await AccessToken.findOne({
      tokenHash: DEST_ADMIN_TOKEN.tokenHash,
    }).lean<{ user?: unknown } | null>();
    expect(restoredToken).not.toBeNull();
    expect(String(restoredToken?.user)).toBe(DEST_ADMIN._id);
  });

  test('rescues the administrator and answers the source successfully when the import itself throws', async () => {
    // `import()` catches one collection's failure, but not the work that follows the loop:
    // `normalizeAllPublicPages()` is uncaught and runs on every migration transfer (design
    // decision D3). So an import that throws is an ordinary path, and it is the one where
    // "the import returned" cannot be relied on — the rescue has to be in a `finally`.
    const importService = getImportService();
    const importOriginal = importService.import.bind(importService);
    vi.spyOn(importService, 'import').mockImplementation(async (...args) => {
      await importOriginal(...args);
      throw new Error('page normalization failed');
    });

    const response = await postReplacingUsers(
      'g2g-proc-import-aborted.growi.zip',
    );

    // Answered successfully on purpose: the source does not go on to transfer a single
    // attachment unless this response succeeds, which would leave the destination with a
    // replaced database and no files at all (requirement 5.2, which design.md ranks above
    // 2.8 for this case). `importAborted` is what keeps that success from being read as
    // "everything arrived" — `failedCollections` cannot say so, because an import that
    // threw hands back no list.
    expect(response.status).toBe(200);
    expect(response.body.importAborted).toBe(true);
    expect(response.body.failedCollections).toEqual([]);

    // The destination still has an administrator it can be reached through
    // (requirement 4.8) — this is what the `try`/`finally` is for.
    expect(response.body.rescueApplied).toBe(true);
    const rescuedAdmin = await User.findOne({
      username: RESCUED_USERNAME,
    }).lean<{ password?: string; admin?: boolean } | null>();
    expect(rescuedAdmin).not.toBeNull();
    expect(rescuedAdmin?.password).toBe(DEST_ADMIN.password);
    expect(rescuedAdmin?.admin).toBe(true);

    // …and the token that administrator was using still resolves (requirement 4.9).
    const restoredToken = await AccessToken.findOne({
      tokenHash: DEST_ADMIN_TOKEN.tokenHash,
    }).lean<{ user?: unknown } | null>();
    expect(restoredToken).not.toBeNull();

    // Nothing can vouch for the destination being complete, so it stays closed
    // (requirement 2.8).
    expect(await readMaintenanceModeFromDb()).toBe(true);
    expect(response.body.maintenanceModeReleased).toBe(false);
  });

  test.each([
    true,
    false,
  ])('puts the maintenance-mode flag back to what it was before the transfer (%s)', async (maintenanceModeBefore) => {
    await configManager.updateConfig(
      'app:isMaintenanceMode',
      maintenanceModeBefore,
    );

    const response = await postReplacingUsers(
      `g2g-proc-restore-${maintenanceModeBefore}.growi.zip`,
    );

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);
    expect(response.body.rescueApplied).toBe(true);

    // Restored, not cleared: a destination that was already closed stays closed
    // (requirement 6.1), and one that was open is opened again.
    expect(await readMaintenanceModeFromDb()).toBe(maintenanceModeBefore);
    expect(response.body.maintenanceModeReleased).toBe(!maintenanceModeBefore);
  });

  test('keeps the destination’s site URL and file upload settings across an import of configs', async () => {
    const zipPath = await writeArchiveZip('g2g-proc-configs.growi.zip', [
      {
        name: 'configs.json',
        content: JSON.stringify([
          {
            _id: '0123456789abcdef014b0020',
            key: 'app:siteUrl',
            value: JSON.stringify(SOURCE_SITE_URL),
          },
          {
            _id: '0123456789abcdef014b0021',
            key: 'app:fileUploadType',
            value: JSON.stringify(SOURCE_FILE_UPLOAD_TYPE),
          },
          {
            _id: '0123456789abcdef014b0022',
            key: 'app:title',
            value: JSON.stringify('imported from the source'),
          },
        ]),
      },
    ]);

    const response = await postArchive(zipPath, ['configs'], {
      configs: { mode: ImportMode.flushAndInsert },
    });

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);

    // The archive's settings really did arrive, so the two assertions below are about
    // what was put back rather than about an import that never ran.
    expect(await readConfigFromDb('app:title')).toBe(
      'imported from the source',
    );

    // Requirements 5.4 and 5.3: the destination keeps being reachable at its own address
    // and keeps storing files where it stored them.
    expect(await readConfigFromDb('app:siteUrl')).toBe(DESTINATION_SITE_URL);
    expect(await readConfigFromDb('app:fileUploadType')).toBe(
      DESTINATION_FILE_UPLOAD_TYPE,
    );

    // Replacing this GROWI's settings with someone else's leaves it closed until the
    // operator opens it (requirement 2.9), and nothing was replaced that would call for
    // a rescue (requirement 6.1).
    expect(await readMaintenanceModeFromDb()).toBe(true);
    expect(response.body.maintenanceModeReleased).toBe(false);
    expect(response.body.rescue).toBeNull();
  });

  test('still answers the source successfully when a clean-up step fails', async () => {
    // A session store that cannot be read: the invalidation throws out of the `finally`.
    // The source does not start transferring attachments unless this response succeeds
    // (requirement 5.2), so a failure here must not become the transfer's failure.
    crowi.sessionConfig = buildSessionConfig({
      get: () => {},
      set: () => {},
      destroy: () => {},
      collectionP: Promise.resolve({
        find: () => {
          throw new Error('the session store is unreachable');
        },
        deleteMany: () => {},
      }),
    });

    const response = await postReplacingUsers(
      'g2g-proc-cleanup-failure.growi.zip',
    );

    expect(response.status).toBe(200);
    expect(response.body.postProcessFailures).toContain('invalidate-sessions');

    // The rest of the clean-up still ran.
    expect(response.body.rescueApplied).toBe(true);
    expect(await User.findOne({ username: RESCUED_USERNAME })).not.toBeNull();
  });

  test('keeps the destination closed when the rescue could not be written back', async () => {
    // `accesstokens` is left out of the transfer, so the administrator's token document
    // is still there when the rescue tries to put its copy back — the re-insertion hits
    // the duplicate `_id` and fails. However it fails, a destination whose rescue did not
    // land must not be handed back to its users (requirement 2.8).
    const zipPath = await writeArchiveZip('g2g-proc-rescue-failure.growi.zip', [
      { name: 'users.json', content: JSON.stringify([ARCHIVE_ADMIN]) },
    ]);

    const response = await postArchive(zipPath, ['users'], {
      users: { mode: ImportMode.flushAndInsert },
    });

    expect(response.status).toBe(200);
    expect(response.body.failedCollections).toEqual([]);
    expect(response.body.rescueApplied).toBe(false);
    expect(response.body.postProcessFailures).toContain(
      'reinsert-rescued-admins',
    );

    expect(await readMaintenanceModeFromDb()).toBe(true);
    expect(response.body.maintenanceModeReleased).toBe(false);
    // The response must not report the plan as the outcome: a rescue that was
    // planned but never written back is not an account the source's operator can be
    // told is on this destination (task 10.3's gate finding). `rescued` is empty, not
    // absent — the source still needs `rescue != null` to tell this apart from a
    // transfer that never needed a rescue at all.
    expect(response.body.rescue).toEqual({ rescued: [] });
  });

  test('destroys the sessions of the replaced users and keeps the rescued administrator’s', async () => {
    await sessionsCollection().insertMany([
      {
        _id: 'g2g-proc-session-admin',
        session: JSON.stringify({ passport: { user: DEST_ADMIN._id } }),
      },
      {
        _id: 'g2g-proc-session-member',
        session: JSON.stringify({ passport: { user: DEST_MEMBER._id } }),
      },
    ]);

    const response = await postReplacingUsers('g2g-proc-sessions.growi.zip');

    expect(response.status).toBe(200);

    // The rescued administrator keeps the identifier it had, so the session established
    // before the transfer still belongs to somebody (requirement 4.3); the replaced
    // member's does not (requirement 5.5).
    const remaining = await sessionsCollection().find({}).toArray();
    expect(remaining.map((doc) => doc._id)).toEqual(['g2g-proc-session-admin']);
  });

  test('neither rescues nor closes the destination for a transfer that replaces nothing', async () => {
    const zipPath = await writeArchiveZip('g2g-proc-merge.growi.zip', [
      { name: 'users.json', content: JSON.stringify([ARCHIVE_NEWCOMER]) },
    ]);

    const response = await postArchive(zipPath, ['users'], {
      users: { mode: ImportMode.insert },
    });

    expect(response.status).toBe(200);

    // A merge transfer behaves as it always did (requirement 6.1): the destination's own
    // accounts are untouched, nobody is rescued, and the flag is not touched at all.
    expect(response.body.rescue).toBeNull();
    expect(response.body.rescueApplied).toBe(false);
    expect(await readMaintenanceModeFromDb()).toBe(false);

    expect(await User.findOne({ username: RESCUED_USERNAME })).toBeNull();
    const untouchedAdmin = await User.findById(DEST_ADMIN._id).lean<{
      username?: string;
      email?: string;
    } | null>();
    expect(untouchedAdmin?.username).toBe(DEST_ADMIN.username);
    expect(untouchedAdmin?.email).toBe(DEST_ADMIN.email);

    // The archive's user was added alongside them.
    expect(await User.findById(ARCHIVE_NEWCOMER._id)).not.toBeNull();
  });
});
