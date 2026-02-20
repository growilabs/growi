import { resolveParentGrant } from './resolve-parent-grant';

const mocks = vi.hoisted(() => {
  const leanMock = vi.fn();
  const findOneMock = vi.fn().mockReturnValue({ lean: leanMock });
  return { findOneMock, leanMock };
});

vi.mock('@growi/core', () => ({
  PageGrant: {
    GRANT_PUBLIC: 1,
    GRANT_RESTRICTED: 2,
    GRANT_OWNER: 4,
    GRANT_USER_GROUP: 5,
  },
}));

vi.mock('mongoose', () => ({
  default: {
    model: () => ({
      findOne: mocks.findOneMock,
    }),
  },
}));

const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;
const GRANT_USER_GROUP = 5;

describe('resolveParentGrant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findOneMock.mockReturnValue({ lean: mocks.leanMock });
  });

  describe('when parent page exists', () => {
    it('should return GRANT_PUBLIC when page has public grant', async () => {
      mocks.leanMock.mockResolvedValue({ grant: GRANT_PUBLIC });

      const result = await resolveParentGrant('/tech-notes/React/');
      expect(result).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when page has owner grant', async () => {
      mocks.leanMock.mockResolvedValue({ grant: GRANT_OWNER });

      const result = await resolveParentGrant('/user/alice/memo/');
      expect(result).toBe(GRANT_OWNER);
    });

    it('should return GRANT_USER_GROUP when page has user group grant', async () => {
      mocks.leanMock.mockResolvedValue({ grant: GRANT_USER_GROUP });

      const result = await resolveParentGrant('/team/engineering/');
      expect(result).toBe(GRANT_USER_GROUP);
    });
  });

  describe('ancestor path traversal', () => {
    it('should find ancestor grant when direct parent does not exist', async () => {
      // /tech-notes/React/state-management → null, /tech-notes/React → found
      mocks.findOneMock.mockImplementation((query: { path: string }) => ({
        lean: vi
          .fn()
          .mockResolvedValue(
            query.path === '/tech-notes/React' ? { grant: GRANT_PUBLIC } : null,
          ),
      }));

      const result = await resolveParentGrant(
        '/tech-notes/React/state-management/',
      );
      expect(result).toBe(GRANT_PUBLIC);
    });

    it('should traverse multiple levels to find ancestor grant', async () => {
      // /a/b/c/d → null, /a/b/c → null, /a/b → null, /a → found
      mocks.findOneMock.mockImplementation((query: { path: string }) => ({
        lean: vi
          .fn()
          .mockResolvedValue(
            query.path === '/a' ? { grant: GRANT_USER_GROUP } : null,
          ),
      }));

      const result = await resolveParentGrant('/a/b/c/d/');
      expect(result).toBe(GRANT_USER_GROUP);
    });

    it('should find root page grant when no intermediate ancestor exists', async () => {
      // /nonexistent/deep → null, /nonexistent → null, / → found
      mocks.findOneMock.mockImplementation((query: { path: string }) => ({
        lean: vi
          .fn()
          .mockResolvedValue(
            query.path === '/' ? { grant: GRANT_PUBLIC } : null,
          ),
      }));

      const result = await resolveParentGrant('/nonexistent/deep/');
      expect(result).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when no ancestor exists at any level', async () => {
      mocks.findOneMock.mockImplementation(() => ({
        lean: vi.fn().mockResolvedValue(null),
      }));

      const result = await resolveParentGrant('/nonexistent/deep/path/');
      expect(result).toBe(GRANT_OWNER);
    });

    it('should stop at direct parent when it exists without further traversal', async () => {
      mocks.findOneMock.mockImplementation((query: { path: string }) => ({
        lean: vi
          .fn()
          .mockResolvedValue(
            query.path === '/tech-notes/React/hooks'
              ? { grant: GRANT_USER_GROUP }
              : { grant: GRANT_PUBLIC },
          ),
      }));

      const result = await resolveParentGrant('/tech-notes/React/hooks/');
      expect(result).toBe(GRANT_USER_GROUP);
      expect(mocks.findOneMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('when no ancestor page exists', () => {
    it('should return GRANT_OWNER (4) as safe default', async () => {
      mocks.findOneMock.mockImplementation(() => ({
        lean: vi.fn().mockResolvedValue(null),
      }));

      const result = await resolveParentGrant('/memo/bob/');
      expect(result).toBe(GRANT_OWNER);
    });
  });

  describe('path normalization', () => {
    it('should strip trailing slash for database lookup', async () => {
      mocks.leanMock.mockResolvedValue({ grant: GRANT_PUBLIC });

      await resolveParentGrant('/tech-notes/');
      expect(mocks.findOneMock).toHaveBeenCalledWith({ path: '/tech-notes' });
    });

    it('should handle path without trailing slash', async () => {
      mocks.leanMock.mockResolvedValue({ grant: GRANT_PUBLIC });

      await resolveParentGrant('/tech-notes');
      expect(mocks.findOneMock).toHaveBeenCalledWith({ path: '/tech-notes' });
    });

    it('should use root path when trailing slash is stripped from root', async () => {
      mocks.leanMock.mockResolvedValue({ grant: GRANT_PUBLIC });

      await resolveParentGrant('/');
      expect(mocks.findOneMock).toHaveBeenCalledWith({ path: '/' });
    });
  });
});
