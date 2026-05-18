/**
 * Contract between the vault E2E integration tests and the globalSetup that
 * provisions their fixture.
 *
 * The tests in this directory MUST NOT bake in implementation-specific values
 * (specific file names, page IDs, free-form fixture data). They reference the
 * constants below; the globalSetup is responsible for materialising them.
 *
 * Page paths are deliberately lower-case-only so the path mapper does not
 * append a pageId-derived suffix, making the mapped file name predictable
 * across runs without inspecting the seeded ObjectIds.
 *
 * If you add a new contract, set it both here AND in the globalSetup; the
 * skip-marker check at the bottom of this file enforces that all required
 * setup env vars are present before the integration tests run.
 */

/** Page paths and exact bodies the globalSetup must materialise. */
export const VAULT_E2E_PAGES = {
  /** Root page — always public, always present in any vault clone. */
  publicRoot: {
    path: '/',
    body: '# vault-e2e public root\nsentinel:root\n',
    /** Filename produced by VaultPathMapper for path='/'. */
    mappedFile: '.md',
  },
  /** A nested public page with a known body. */
  publicDeep: {
    path: '/vault-e2e/public-deep',
    body: '# public deep page\nsentinel:public-deep\n',
    mappedFile: 'vault-e2e/public-deep.md',
  },
  /**
   * A page granted GRANT_OWNER to the admin user. The member user must not
   * see this file in their clone.
   */
  adminOnly: {
    path: '/vault-e2e/admin-only',
    body: '# admin only secret\nsentinel:admin-only\n',
    mappedFile: 'vault-e2e/admin-only.md',
  },
} as const;

/**
 * Environment variables populated by the globalSetup.
 *
 * Each getter throws when read before the setup has run, surfacing the
 * "fixture not provisioned" condition as a loud test failure rather than
 * a silent skip — which is precisely what the prior `describe.skip` did.
 */
function readRequired(name: string): string {
  const value = process.env[name];
  if (value == null || value === '') {
    throw new Error(
      `vault E2E fixture not provisioned: ${name} is unset. ` +
        'globalSetup at test/setup/vault-e2e/global-setup.ts must populate it.',
    );
  }
  return value;
}

export const VAULT_E2E_CONFIG = {
  /** Base URL of the Express server that mounts the vault routes. */
  get baseUrl(): string {
    return readRequired('VAULT_E2E_BASE_URL');
  },

  admin: {
    get pat(): string {
      return readRequired('VAULT_E2E_ADMIN_PAT');
    },
    get userId(): string {
      return readRequired('VAULT_E2E_ADMIN_USER_ID');
    },
    get username(): string {
      return readRequired('VAULT_E2E_ADMIN_USERNAME');
    },
  },

  /** Non-admin member with read access only to public pages. */
  member: {
    get pat(): string {
      return readRequired('VAULT_E2E_MEMBER_PAT');
    },
    get userId(): string {
      return readRequired('VAULT_E2E_MEMBER_USER_ID');
    },
    get username(): string {
      return readRequired('VAULT_E2E_MEMBER_USERNAME');
    },
  },
} as const;

/**
 * Returns true when the globalSetup has provisioned the fixture.
 *
 * Used by integ test files to skip themselves cleanly when the setup module
 * has not yet shipped (during incremental rollout). Once the setup is in
 * place this returns true unconditionally and tests run on every CI run.
 *
 * INTENT: this flag exists ONLY as a transient gate during the rollout of
 * the self-contained setup. Once `globalSetup` lands in
 * `apps/app/vitest.workspace.mts` and seeds the fixture, the env var
 * `VAULT_E2E_FIXTURE_READY=1` is always set, and the gate disappears.
 */
export function isVaultE2eFixtureReady(): boolean {
  return process.env.VAULT_E2E_FIXTURE_READY === '1';
}
