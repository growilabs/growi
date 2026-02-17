import { generateMemoSuggestion } from './generate-memo-suggestion';

const mocks = vi.hoisted(() => {
  return {
    configManagerMock: {
      getConfig: vi.fn(),
    },
  };
});

vi.mock('@growi/core', () => ({
  PageGrant: {
    GRANT_PUBLIC: 1,
    GRANT_RESTRICTED: 2,
    GRANT_OWNER: 4,
    GRANT_USER_GROUP: 5,
  },
}));

vi.mock('@growi/core/dist/utils/page-path-utils', () => ({
  userHomepagePath: (user: { username: string }) => `/user/${user.username}`,
}));

vi.mock('~/server/service/config-manager', () => {
  return { configManager: mocks.configManagerMock };
});

const GRANT_OWNER = 4;

describe('generateMemoSuggestion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('when user pages are enabled (default)', () => {
    beforeEach(() => {
      mocks.configManagerMock.getConfig.mockImplementation((key: string) => {
        if (key === 'security:disableUserPages') return false;
        return undefined;
      });
    });

    it('should return a suggestion with type "memo"', () => {
      const result = generateMemoSuggestion({ username: 'alice' });
      expect(result.type).toBe('memo');
    });

    it('should generate path under user home directory', () => {
      const result = generateMemoSuggestion({ username: 'alice' });
      expect(result.path).toBe('/user/alice/memo/');
    });

    it('should set grant to GRANT_OWNER (4)', () => {
      const result = generateMemoSuggestion({ username: 'alice' });
      expect(result.grant).toBe(GRANT_OWNER);
    });

    it('should include a fixed description', () => {
      const result = generateMemoSuggestion({ username: 'alice' });
      expect(result.description).toBe('Save to your personal memo area');
    });

    it('should include a label', () => {
      const result = generateMemoSuggestion({ username: 'alice' });
      expect(result.label).toBe('Save as memo');
    });

    it('should generate path with trailing slash', () => {
      const result = generateMemoSuggestion({ username: 'alice' });
      expect(result.path).toMatch(/\/$/);
    });
  });

  describe('when user pages are disabled', () => {
    beforeEach(() => {
      mocks.configManagerMock.getConfig.mockImplementation((key: string) => {
        if (key === 'security:disableUserPages') return true;
        return undefined;
      });
    });

    it('should generate path under alternative namespace', () => {
      const result = generateMemoSuggestion({ username: 'bob' });
      expect(result.path).toBe('/memo/bob/');
    });

    it('should set grant to GRANT_OWNER (4) as hardcoded default in Phase 1', () => {
      const result = generateMemoSuggestion({ username: 'bob' });
      expect(result.grant).toBe(GRANT_OWNER);
    });

    it('should return a suggestion with type "memo"', () => {
      const result = generateMemoSuggestion({ username: 'bob' });
      expect(result.type).toBe('memo');
    });

    it('should generate path with trailing slash', () => {
      const result = generateMemoSuggestion({ username: 'bob' });
      expect(result.path).toMatch(/\/$/);
    });

    it('should include same fixed description as enabled case', () => {
      const result = generateMemoSuggestion({ username: 'bob' });
      expect(result.description).toBe('Save to your personal memo area');
    });
  });
});
