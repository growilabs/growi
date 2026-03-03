import { generateMemoSuggestion } from './generate-memo-suggestion';

const mocks = vi.hoisted(() => {
  return {
    configManagerMock: {
      getConfig: vi.fn(),
    },
    resolveParentGrantMock: vi.fn(),
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

vi.mock('./resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;
const GRANT_USER_GROUP = 5;

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

    it('should return a suggestion with type "memo"', async () => {
      const result = await generateMemoSuggestion({ username: 'alice' });
      expect(result.type).toBe('memo');
    });

    it('should generate path under user home directory', async () => {
      const result = await generateMemoSuggestion({ username: 'alice' });
      expect(result.path).toBe('/user/alice/memo/');
    });

    it('should set grant to GRANT_OWNER (4)', async () => {
      const result = await generateMemoSuggestion({ username: 'alice' });
      expect(result.grant).toBe(GRANT_OWNER);
    });

    it('should not call resolveParentGrant', async () => {
      await generateMemoSuggestion({ username: 'alice' });
      expect(mocks.resolveParentGrantMock).not.toHaveBeenCalled();
    });

    it('should include a fixed description', async () => {
      const result = await generateMemoSuggestion({ username: 'alice' });
      expect(result.description).toBe('Save to your personal memo area');
    });

    it('should include a label', async () => {
      const result = await generateMemoSuggestion({ username: 'alice' });
      expect(result.label).toBe('Save as memo');
    });

    it('should generate path with trailing slash', async () => {
      const result = await generateMemoSuggestion({ username: 'alice' });
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

    it('should generate path under alternative namespace', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const result = await generateMemoSuggestion({ username: 'bob' });
      expect(result.path).toBe('/memo/bob/');
    });

    it('should resolve grant from parent page via resolveParentGrant', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
      const result = await generateMemoSuggestion({ username: 'bob' });
      expect(result.grant).toBe(GRANT_PUBLIC);
    });

    it('should call resolveParentGrant with the generated path', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      await generateMemoSuggestion({ username: 'bob' });
      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/memo/bob/');
    });

    it('should use GRANT_USER_GROUP when parent has user group grant', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_USER_GROUP);
      const result = await generateMemoSuggestion({ username: 'bob' });
      expect(result.grant).toBe(GRANT_USER_GROUP);
    });

    it('should return a suggestion with type "memo"', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const result = await generateMemoSuggestion({ username: 'bob' });
      expect(result.type).toBe('memo');
    });

    it('should generate path with trailing slash', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const result = await generateMemoSuggestion({ username: 'bob' });
      expect(result.path).toMatch(/\/$/);
    });

    it('should include same fixed description as enabled case', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const result = await generateMemoSuggestion({ username: 'bob' });
      expect(result.description).toBe('Save to your personal memo area');
    });
  });
});
