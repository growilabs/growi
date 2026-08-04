import type { IUser } from '../../interfaces/user.js';
import {
  omitInsecureAttributes,
  serializeUserSecurely,
} from './user-serializer.js';

describe('user-serializer', () => {
  const buildUser = (overrides: Partial<IUser> = {}): IUser =>
    ({
      name: 'Test User',
      username: 'test-user',
      email: 'test@example.com',
      password: 'plain-legacy-hash',
      passwordHash: 'scrypt$16384$8$1$c29tZXNhbHQ$c29tZWhhc2g',
      apiToken: 'secret-api-token',
      isEmailPublished: false,
      // remaining required fields are irrelevant to these assertions
      ...overrides,
    }) as unknown as IUser;

  describe('omitInsecureAttributes', () => {
    it('omits insecure attributes (password, passwordHash, apiToken) while keeping safe fields', () => {
      // Act
      const result = omitInsecureAttributes(buildUser());

      // Assert: insecure fields are stripped
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('apiToken');
      // email is omitted when not published
      expect(result).not.toHaveProperty('email');

      // Assert: safe fields are retained
      expect(result.name).toBe('Test User');
      expect(result.username).toBe('test-user');
    });

    it('keeps email when isEmailPublished is true, but still omits passwordHash', () => {
      const result = omitInsecureAttributes(
        buildUser({ isEmailPublished: true }),
      );

      expect(result.email).toBe('test@example.com');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('serializeUserSecurely', () => {
    it('does not expose passwordHash in the serialized user', () => {
      const result = serializeUserSecurely(buildUser());

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('apiToken');
    });
  });

  describe('IUser type', () => {
    it('accepts an optional passwordHash field', () => {
      // Type-level assertion: this object must typecheck against IUser
      const user = buildUser({ passwordHash: 'scrypt$...' });
      expect(user.passwordHash).toBe('scrypt$...');
    });
  });
});
