/**
 * Route-level integration test for what the destination tells the source about itself
 * before a transfer starts (requirements 3.1, 3.5, 3.6, 3.7).
 *
 * The source cannot see the destination's database, so everything the operator is shown
 * before the archive is built — how much will be deleted, whether anyone will still be
 * able to log in, whether the passwords survive, whether the sessions can be cut — comes
 * from this one answer. It is therefore exercised over HTTP with a real transfer key, and
 * checked against the database rather than against a spy: the counts are compared as
 * deltas around fixtures this file seeds, so leftovers of other files sharing the
 * per-worker database cannot make them look right by accident.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IUser } from '@growi/core';
import type MongoStore from 'connect-mongo';
import express from 'express';
import mongoose, { type Model } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { SessionConfig } from '~/interfaces/session-config';
import type Crowi from '~/server/crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '~/server/crowi/setup-models';
import type UserEvent from '~/server/events/user';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import instanciateExportService from '~/server/service/export';
import type { FileUploader } from '~/server/service/file-uploader';
import {
  computePasswordSeedFingerprint,
  type G2GTransferPusherService,
  G2GTransferReceiverService,
  X_GROWI_TRANSFER_KEY_HEADER_NAME,
} from '~/server/service/g2g-transfer';
import { resolveSessionAccess } from '~/server/service/g2g-transfer-session-invalidation';
import { GrowiBridgeService } from '~/server/service/growi-bridge';
import { initializeImportService } from '~/server/service/import';
import { TransferKey } from '~/utils/vo/transfer-key';

import { setup } from './g2g-transfer';
import addCustomFunctionToResponse from './response';

/** Only this destination's environment holds it; a fingerprint of it is what may travel. */
const PASSWORD_SEED = 'g2g-growi-info-destination-seed';

const PREFIX = 'g2g-growi-info';

/** Active, an administrator, and has a password: the one account that can still log in. */
const LOGINABLE_ADMIN = {
  username: `${PREFIX}-loginable-admin`,
  email: `${PREFIX}-loginable-admin@example.com`,
  admin: true,
  status: UserStatus.STATUS_ACTIVE,
  password: 'a-password-hash',
} as const;

/** An administrator who signs in through an external account, so there is no password. */
const EXTERNAL_ONLY_ADMIN = {
  username: `${PREFIX}-external-admin`,
  email: `${PREFIX}-external-admin@example.com`,
  admin: true,
  status: UserStatus.STATUS_ACTIVE,
} as const;

/** Has a password, but `loginRequired` turns a suspended account away. */
const SUSPENDED_ADMIN = {
  username: `${PREFIX}-suspended-admin`,
  email: `${PREFIX}-suspended-admin@example.com`,
  admin: true,
  status: UserStatus.STATUS_SUSPENDED,
  password: 'a-password-hash',
} as const;

/** Can log in, but is not an administrator. */
const MEMBER = {
  username: `${PREFIX}-member`,
  email: `${PREFIX}-member@example.com`,
  admin: false,
  status: UserStatus.STATUS_ACTIVE,
  password: 'a-password-hash',
} as const;

const SEEDED_USERS = [
  LOGINABLE_ADMIN,
  EXTERNAL_ONLY_ADMIN,
  SUSPENDED_ADMIN,
  MEMBER,
] as const;

const SEEDED_GROUP_NAMES = [`${PREFIX}-group-a`, `${PREFIX}-group-b`] as const;
const SEEDED_PAGE_PATHS = [
  `/${PREFIX}-page-1`,
  `/${PREFIX}-page-2`,
  `/${PREFIX}-page-3`,
] as const;

const SESSION_ID = `${PREFIX}-session`;

type DestinationReport = {
  destinationCounts: { users: number; userGroups: number; pages: number };
  passwordSeedFingerprint: string;
  loginableAdminCount: number;
  sessionStoreSupportsEnumeration: boolean;
};

describe('receive route GET /growi-info — the destination reports its own state', () => {
  let app: express.Application;
  let crowi: Crowi;
  let User: Model<IUser>;
  let sessionStore: MongoStore;
  let baseSessionConfig: SessionConfig;
  let tmpDir: string;
  let transferKeyValue: string;

  const askGROWIInfo = async (): Promise<{
    body: { growiInfo: DestinationReport };
    text: string;
  }> => {
    const response = await request(app)
      .get('/growi-info')
      .set(X_GROWI_TRANSFER_KEY_HEADER_NAME, transferKeyValue);

    expect(response.status).toBe(200);
    return response;
  };

  const seedFixtures = async (): Promise<void> => {
    await User.create(SEEDED_USERS.map((user) => ({ ...user })));
    await mongoose
      .model('UserGroup')
      .create(SEEDED_GROUP_NAMES.map((name) => ({ name })));
    // The raw driver, so this file does not depend on which fields the Page schema
    // happens to require; the count reads the same collection either way.
    await mongoose.connection
      .collection('pages')
      .insertMany(SEEDED_PAGE_PATHS.map((pagePath) => ({ path: pagePath })));
  };

  const removeFixtures = async (): Promise<void> => {
    await User.deleteMany({
      username: { $in: SEEDED_USERS.map((user) => user.username) },
    });
    await mongoose
      .model('UserGroup')
      .deleteMany({ name: { $in: [...SEEDED_GROUP_NAMES] } });
    await mongoose.connection
      .collection('pages')
      .deleteMany({ path: { $in: [...SEEDED_PAGE_PATHS] } });
    await mongoose.connection
      .collection('sessions')
      .deleteMany({ _id: SESSION_ID });
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'g2g-growi-info-'));
    await fs.mkdir(path.join(tmpDir, 'imports'), { recursive: true });

    crowi = mock<Crowi>({
      tmpDir,
      env: { PASSWORD_SEED },
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
        admin: new EventEmitter(),
      },
      // The attachment side of this answer is pre-existing behaviour this file does not
      // touch; it only has to be answerable without a storage backend.
      fileUploadService: mock<FileUploader>({
        getFileUploadTotalLimit: () => 0,
        isWritable: async () => true,
      }),
    });
    crowi.growiBridgeService = new GrowiBridgeService(crowi);
    initializeImportService(crowi);
    instanciateExportService(crowi);

    await setupModelsDependentOnCrowi(crowi);
    await setupIndependentModels();

    User = mongoose.model<IUser>('User');

    // The store GROWI builds when no Redis URL is configured — the default deployment,
    // and the one `connect-mongo`'s `all()` cannot identify sessions in.
    const { default: MongoStoreClass } = await import('connect-mongo');
    sessionStore = MongoStoreClass.create({
      client: mongoose.connection.getClient(),
    });
    baseSessionConfig = {
      rolling: true,
      secret: 'g2g-growi-info-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 1000 },
      genid: () => SESSION_ID,
      store: sessionStore,
    };
    crowi.sessionConfig = baseSessionConfig;

    const receiverService = new G2GTransferReceiverService(crowi);
    crowi.g2gTransferReceiverService = receiverService;
    // Nothing here pushes a transfer; the router only refuses to be built without one.
    crowi.g2gTransferPusherService = mock<G2GTransferPusherService>();

    await configManager.loadConfigs();
    addCustomFunctionToResponse(express);

    app = express();
    app.use(setup(crowi));

    const transferKeyString = await receiverService.createTransferKey(
      'http://g2g-growi-info-source.example.com',
    );
    transferKeyValue = TransferKey.parse(transferKeyString).key;

    await removeFixtures();
  }, 120_000);

  afterEach(async () => {
    crowi.sessionConfig = baseSessionConfig;
    await removeFixtures();
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('counts what a migration transfer would delete, and names none of it', async () => {
    // Requirement 3.1 — the operator is shown how much of the destination goes away, and
    // 3.6's sibling constraint on this answer: numbers only, no usernames or addresses.
    const before = (await askGROWIInfo()).body.growiInfo.destinationCounts;

    await seedFixtures();

    const response = await askGROWIInfo();
    const after = response.body.growiInfo.destinationCounts;

    expect(after.users - before.users).toBe(SEEDED_USERS.length);
    expect(after.userGroups - before.userGroups).toBe(
      SEEDED_GROUP_NAMES.length,
    );
    expect(after.pages - before.pages).toBe(SEEDED_PAGE_PATHS.length);

    for (const user of SEEDED_USERS) {
      expect(response.text).not.toContain(user.username);
      expect(response.text).not.toContain(user.email);
    }
    for (const name of SEEDED_GROUP_NAMES) {
      expect(response.text).not.toContain(name);
    }
  });

  test('counts only the administrators who could actually log in', async () => {
    // Requirement 3.5 — the warning fires on `loginableAdminCount === 0`, so an
    // administrator without a password or in a suspended state must not be counted:
    // counting them would hide "nobody can log in after this transfer" behind a number
    // that looks fine. A destination whose administrators all authenticate through an
    // external account reports none.
    const before = (await askGROWIInfo()).body.growiInfo.loginableAdminCount;

    await seedFixtures();

    const after = (await askGROWIInfo()).body.growiInfo.loginableAdminCount;

    expect(after - before).toBe(1);
  });

  test('sends a fingerprint of the password seed, never the seed', async () => {
    // Requirement 3.6 — the seed is what every password hash on this GROWI is derived
    // from. The source only has to learn whether its own seed matches.
    const response = await askGROWIInfo();

    expect(response.text).not.toContain(PASSWORD_SEED);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD_SEED);
    expect(response.body.growiInfo.passwordSeedFingerprint).toBe(
      computePasswordSeedFingerprint(PASSWORD_SEED),
    );
  });

  test('reports that sessions can be selected, and can reach the ones this store keeps', async () => {
    // Requirement 3.7 — the claim only means something if the destination can act on it
    // later. What makes the answer `true` is the collection the resolution produced, and
    // this is that same collection: a session written into it is the session the store
    // itself then reads back. Announcing support from anything else (the presence of
    // `all()`, say) would leave the destination promising an invalidation it cannot
    // perform, since `connect-mongo`'s `all()` reports no session ids to destroy by.
    const response = await askGROWIInfo();

    expect(response.body.growiInfo.sessionStoreSupportsEnumeration).toBe(true);

    const access = await resolveSessionAccess(sessionStore);
    expect(access.kind).toBe('sessions-collection');
    if (access.kind !== 'sessions-collection') {
      return;
    }

    await access.sessionsCollection.insertOne({
      _id: SESSION_ID,
      session: JSON.stringify({ passport: { user: 'a-destination-user' } }),
      expires: new Date(Date.now() + 60_000),
    });

    const storedSession = await new Promise((resolve, reject) => {
      sessionStore.get(SESSION_ID, (err, session) =>
        err != null ? reject(err) : resolve(session),
      );
    });

    expect(storedSession).toMatchObject({
      passport: { user: 'a-destination-user' },
    });
  });

  test('does not claim sessions can be selected when the store only enumerates them', async () => {
    // The failure this rules out: `connect-mongo`'s `all()` hands back session bodies
    // with no ids at all, so a destination that answered "supported" because the store
    // has an `all()` would suppress the operator's warning and then destroy nothing.
    // Only the resolution that produces the means may decide this.
    crowi.sessionConfig = {
      ...baseSessionConfig,
      store: {
        get: vi.fn(),
        set: vi.fn(),
        destroy: vi.fn(),
        all: vi.fn((callback: (err: unknown, sessions: unknown[]) => void) =>
          callback(null, [{ passport: { user: 'a-destination-user' } }]),
        ),
      },
    };

    const response = await askGROWIInfo();

    expect(response.body.growiInfo.sessionStoreSupportsEnumeration).toBe(false);
  });

  test.each([
    { label: 'no transfer key at all', headers: {} },
    {
      label: 'a transfer key this GROWI never issued',
      headers: { [X_GROWI_TRANSFER_KEY_HEADER_NAME]: 'not-a-transfer-key' },
    },
  ])('tells a caller with $label nothing about itself', async ({ headers }) => {
    // design.md Security Considerations — this answer is inside the transfer key's
    // authentication and has to stay there. It now carries how many users the
    // destination has and a fingerprint of its password seed, so a caller who cannot
    // prove the operator handed them a key must not learn either.
    await seedFixtures();

    const response = await request(app).get('/growi-info').set(headers);

    expect(response.status).toBe(403);
    expect(response.text).not.toContain('destinationCounts');
    expect(response.text).not.toContain('passwordSeedFingerprint');
    expect(response.text).not.toContain(
      computePasswordSeedFingerprint(PASSWORD_SEED),
    );
  });
});
