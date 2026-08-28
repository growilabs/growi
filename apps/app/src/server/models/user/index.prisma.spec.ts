/**
 * Guard for the Prisma `users` extension's `serializeSecurely()`.
 *
 * WHY this exists: `compute` receives the FULL result record, so a credential
 * field is only dropped if the omission logic knows to strip it — listing it in
 * `needs` alone is not enough. When `passwordHash` was added to the schema but not
 * to `compute`'s (then hard-coded) destructure, `GET /_api/v3/bookmarks/info`
 * (the only caller, via `bookmark.user.serializeSecurely()`) returned every
 * bookmarking user's scrypt envelope, and neither typecheck nor any other test
 * caught it. This spec pins the omission set.
 *
 * `compute` now drives its omission from @growi/core's shared
 * `isInsecureUserAttribute` (the single source it shares with
 * `omitInsecureAttributes()`), so this can no longer drift from the core list on
 * its own — but the guard stays as the behavioral pin for that shared contract.
 *
 * DB-free: the extension definition is invoked with a stub client so only the
 * pure `compute` is exercised — no connection is opened.
 */
import { extension } from './index.prisma';

type ComputeFn = (record: Record<string, unknown>) => () => unknown;

/** Pull `serializeSecurely`'s compute out of the extension definition. */
const getSerializeCompute = (): ComputeFn => {
  let compute: ComputeFn | undefined;

  const stubClient = {
    $extends: (args: {
      result: { users: { serializeSecurely: { compute: ComputeFn } } };
    }) => {
      compute = args.result.users.serializeSecurely.compute;
      return {};
    },
  };

  // `extension` is the Prisma.defineExtension callback: it calls client.$extends(...)
  (extension as unknown as (client: unknown) => unknown)(stubClient);

  if (compute == null) {
    throw new Error('serializeSecurely compute was not found on the extension');
  }
  return compute;
};

// Every credential field is populated so an omission failure is observable
// rather than vacuous.
const buildUserRecord = (overrides: Record<string, unknown> = {}) => ({
  id: '507f1f77bcf86cd799439011',
  username: 'alice',
  name: 'Alice',
  password: 'legacy-sha256-hash',
  passwordHash: 'scrypt$131072$8$1$c2FsdA==$aGFzaA==',
  apiToken: 'api-token-value',
  email: 'alice@example.com',
  isEmailPublished: false,
  ...overrides,
});

const serialize = (record: Record<string, unknown>) =>
  getSerializeCompute()(record)() as Record<string, unknown>;

describe('users prisma extension — serializeSecurely()', () => {
  it('omits every credential field from the serialized user', () => {
    const result = serialize(buildUserRecord());

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('apiToken');
  });

  it('retains the safe fields', () => {
    const result = serialize(buildUserRecord());

    expect(result.username).toBe('alice');
    expect(result.name).toBe('Alice');
  });

  it('hides the email unless it is published', () => {
    expect(serialize(buildUserRecord()).email).toBeUndefined();
    expect(serialize(buildUserRecord({ isEmailPublished: true })).email).toBe(
      'alice@example.com',
    );
  });
});
