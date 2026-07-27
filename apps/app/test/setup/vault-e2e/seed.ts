/**
 * Direct-DB seed for the vault E2E fixture.
 *
 * We register the minimal set of mongoose models we need (configs, users,
 * pages, revisions, access tokens), then insert the deterministic fixture
 * data declared in `src/features/growi-vault/__tests__/fixture-contract.ts`.
 *
 * The seed is intentionally idempotent within a single test process so it can
 * be re-run after a state-clearing test without redoing all of the wiring.
 */

import { PageGrant, PageStatus } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import { VAULT_E2E_PAGES } from '~/features/growi-vault/__tests__/fixture-contract';
import { setupIndependentModels } from '~/server/crowi/setup-models';

/**
 * Output of seedVaultE2eFixture — values consumed by the provision step to
 * set `VAULT_E2E_*` env vars consumed by the integ tests.
 */
export interface SeedResult {
  readonly admin: { userId: string; username: string; pat: string };
  readonly member: { userId: string; username: string; pat: string };
}

/**
 * Register the Crowi-dependent models needed for the vault E2E suite.
 *
 * Some "independent" models (e.g. bookmark-folder) reference Bookmark at
 * import time via `mongoose.model('Bookmark')`. Bookmark's factory in turn
 * requires `crowi.events.bookmark`. We satisfy these requirements with a
 * minimal stub Crowi whose only purpose is to make model registration
 * complete — the vault gateway router doesn't actually use any of these
 * methods.
 */
// biome-ignore lint/suspicious/noExplicitAny: minimal stub for model registration only
type StubCrowi = any;

async function registerCrowiBoundModels(): Promise<void> {
  const noopEmitter = { on() {}, off() {}, emit() {} };
  const stubCrowi: StubCrowi = {
    events: {
      page: noopEmitter,
      bookmark: noopEmitter,
      activity: noopEmitter,
      tag: noopEmitter,
      user: noopEmitter,
      comment: noopEmitter,
    },
    model: (name: string) => mongoose.model(name),
  };

  // Skip if Page is already registered — model registration is idempotent
  // in spirit but discriminators (e.g. GlobalNotificationMailSetting) and
  // schema hooks throw if executed twice. With isolate=false across files
  // in the singleFork pool, we may re-enter this function on file 2.
  if (mongoose.modelNames().includes('Page')) {
    return;
  }

  // Page + User accept a nullable Crowi; pass null so methods needing Crowi
  // throw clearly if accidentally called.
  const PageModelFactory = (await import('~/server/models/page')).default;
  PageModelFactory(null);
  const UserModelFactory = (await import('~/server/models/user')).default;
  UserModelFactory(null);

  const GlobalNotificationSettingFactory = (
    await import('~/server/models/GlobalNotificationSetting')
  ).default;
  GlobalNotificationSettingFactory(stubCrowi);
  const GlobalNotificationMailSettingFactory = (
    await import(
      '~/server/models/GlobalNotificationSetting/GlobalNotificationMailSetting'
    )
  ).default;
  GlobalNotificationMailSettingFactory(stubCrowi);
  const GlobalNotificationSlackSettingFactory = (
    await import(
      '~/server/models/GlobalNotificationSetting/GlobalNotificationSlackSetting'
    )
  ).default;
  GlobalNotificationSlackSettingFactory(stubCrowi);
  const SlackAppIntegrationFactory = (
    await import('~/server/models/slack-app-integration')
  ).default;
  SlackAppIntegrationFactory(stubCrowi);
}

/**
 * Seed vault configs and a deterministic fixture. Must be called after
 * `mongoose.connect()` and BEFORE configManager.loadConfigs() is invoked.
 *
 * @param vaultManagerEndpoint - The endpoint the spawned vault-manager listens on.
 * @param internalSecret - The same secret passed to the spawned vault-manager
 *   process. Stored in `app:vaultManagerInternalSecret` so the apps/app side
 *   uses it when calling vault-manager.
 */
export async function seedVaultE2eFixture(
  vaultManagerEndpoint: string,
  internalSecret: string,
): Promise<SeedResult> {
  // Register Crowi-bound models first — some independent models (e.g.
  // bookmark-folder) reference Bookmark via mongoose.model('Bookmark') at
  // import time and will fail if Bookmark isn't registered yet.
  // Both functions guard against double-registration via mongoose.modelNames.
  await registerCrowiBoundModels();
  if (!mongoose.modelNames().includes('Comment')) {
    await setupIndependentModels();
  }

  // -----------------------------------------------------------------
  // Configs that configManager.loadConfigs() will read.
  // -----------------------------------------------------------------
  const Config = mongoose.connection.db.collection('configs');
  await Config.bulkWrite([
    {
      updateOne: {
        filter: { key: 'app:vaultEnabled' },
        update: { $set: { value: JSON.stringify(true) } },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { key: 'app:vaultManagerEndpoint' },
        update: { $set: { value: JSON.stringify(vaultManagerEndpoint) } },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { key: 'app:vaultManagerInternalSecret' },
        update: { $set: { value: JSON.stringify(internalSecret) } },
        upsert: true,
      },
    },
  ]);

  // -----------------------------------------------------------------
  // Users — minimal shape, just enough for Page.creator and the access-token
  // population to resolve.
  // -----------------------------------------------------------------
  const Users = mongoose.connection.db.collection('users');
  const adminUserId = new mongoose.Types.ObjectId();
  const memberUserId = new mongoose.Types.ObjectId();
  await Users.insertMany([
    {
      _id: adminUserId,
      name: 'Vault E2E Admin',
      username: 'vault-e2e-admin',
      email: 'vault-e2e-admin@example.invalid',
      admin: true,
      status: 2, // STATUS_ACTIVE
      createdAt: new Date(),
    },
    {
      _id: memberUserId,
      name: 'Vault E2E Member',
      username: 'vault-e2e-member',
      email: 'vault-e2e-member@example.invalid',
      admin: false,
      status: 2,
      createdAt: new Date(),
    },
  ]);

  // -----------------------------------------------------------------
  // Access tokens — use AccessToken.generateToken so the same hashing
  // logic the auth middleware exercises is what we seed.
  // -----------------------------------------------------------------
  const { AccessToken } = await import('~/server/models/access-token');
  const exp = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const adminPat = await AccessToken.generateToken(
    adminUserId,
    exp,
    ['read:features:page'],
    'vault-e2e-admin-pat',
  );
  const memberPat = await AccessToken.generateToken(
    memberUserId,
    exp,
    ['read:features:page'],
    'vault-e2e-member-pat',
  );

  // -----------------------------------------------------------------
  // Pages + Revisions — deterministic bodies from fixture-contract.
  // -----------------------------------------------------------------
  const Pages = mongoose.connection.db.collection('pages');
  const Revisions = mongoose.connection.db.collection('revisions');

  const makePage = async (
    page: { path: string; body: string },
    grant: number,
    creator: Types.ObjectId,
  ) => {
    const pageId = new mongoose.Types.ObjectId();
    const revisionId = new mongoose.Types.ObjectId();
    await Revisions.insertOne({
      _id: revisionId,
      pageId,
      body: page.body,
      author: creator,
      createdAt: new Date(),
    });
    await Pages.insertOne({
      _id: pageId,
      path: page.path,
      status: PageStatus.STATUS_PUBLISHED,
      grant,
      grantedUsers: grant === PageGrant.GRANT_OWNER ? [creator] : [],
      grantedGroups: [],
      revision: revisionId,
      creator,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUpdateUser: creator,
    });
  };

  await makePage(
    VAULT_E2E_PAGES.publicRoot,
    PageGrant.GRANT_PUBLIC,
    adminUserId,
  );
  await makePage(
    VAULT_E2E_PAGES.publicDeep,
    PageGrant.GRANT_PUBLIC,
    adminUserId,
  );
  await makePage(VAULT_E2E_PAGES.adminOnly, PageGrant.GRANT_OWNER, adminUserId);

  return {
    admin: {
      userId: adminUserId.toString(),
      username: 'vault-e2e-admin',
      pat: adminPat.token,
    },
    member: {
      userId: memberUserId.toString(),
      username: 'vault-e2e-member',
      pat: memberPat.token,
    },
  };
}
