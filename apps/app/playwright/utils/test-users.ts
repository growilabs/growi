import path from 'node:path';

export interface TestUser {
  email: string;
  username: string;
  name: string;
  password: string;
  /** storageState file holding this user's authenticated session */
  authFile: string;
}

const authDir = path.resolve(__dirname, '../.auth');

// Shared password for every provisioned test user (>= 6 ASCII chars, see
// invited-form-validator). Not a secret — these accounts only exist in the
// disposable e2e database.
const password = 'e2e-filter-password';

/**
 * Users provisioned by `users.setup.ts` for the search-filter tests (author,
 * editor and group). Declared here as the single source of truth so the setup
 * that creates them and the specs that act as them read the same list.
 */
export const FILTER_TEST_USER_A: TestUser = {
  email: 'e2e-filter-author-a@example.com',
  username: 'e2e-filter-author-a',
  name: 'E2E Filter Author A',
  password,
  authFile: path.resolve(authDir, 'e2e-filter-author-a.json'),
};

export const FILTER_TEST_USER_B: TestUser = {
  email: 'e2e-filter-author-b@example.com',
  username: 'e2e-filter-author-b',
  name: 'E2E Filter Author B',
  password,
  authFile: path.resolve(authDir, 'e2e-filter-author-b.json'),
};

export const FILTER_TEST_USERS: readonly TestUser[] = [
  FILTER_TEST_USER_A,
  FILTER_TEST_USER_B,
];

/**
 * User group used by the `group:` filter test. The `group:` qualifier resolves
 * this name against the *searcher's* own memberships, so the search must run as
 * a member (FILTER_TEST_USER_A is added to it in the spec setup).
 */
export const FILTER_GROUP_NAME = 'e2e-filter-group';
