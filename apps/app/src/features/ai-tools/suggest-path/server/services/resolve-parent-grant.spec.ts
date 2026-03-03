import { getAncestorPaths, resolveParentGrant } from './resolve-parent-grant';

const mocks = vi.hoisted(() => {
  const leanMock = vi.fn();
  const selectMock = vi.fn().mockReturnValue({ lean: leanMock });
  const findMock = vi.fn().mockReturnValue({ select: selectMock });
  return { findMock, selectMock, leanMock };
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
      find: mocks.findMock,
    }),
  },
}));

const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;
const GRANT_USER_GROUP = 5;

describe('getAncestorPaths', () => {
  it('should return ancestors from child to root', () => {
    expect(getAncestorPaths('/a/b/c')).toEqual(['/a/b/c', '/a/b', '/a', '/']);
  });

  it('should return path and root for single-level path', () => {
    expect(getAncestorPaths('/tech-notes')).toEqual(['/tech-notes', '/']);
  });

  it('should return only root for root path', () => {
    expect(getAncestorPaths('/')).toEqual(['/']);
  });

  it('should respect max depth guard', () => {
    const deepSegments = Array.from({ length: 60 }, (_, i) => `level${i}`);
    const deepPath = `/${deepSegments.join('/')}`;

    const result = getAncestorPaths(deepPath);
    // 50 ancestors + root = 51 max
    expect(result.length).toBeLessThanOrEqual(51);
    expect(result[result.length - 1]).toBe('/');
  });
});

describe('resolveParentGrant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMock.mockReturnValue({ select: mocks.selectMock });
    mocks.selectMock.mockReturnValue({ lean: mocks.leanMock });
  });

  describe('when parent page exists', () => {
    it('should return GRANT_PUBLIC when page has public grant', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/tech-notes', grant: GRANT_PUBLIC },
      ]);

      const result = await resolveParentGrant('/tech-notes/');
      expect(result).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when page has owner grant', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/user/alice/memo', grant: GRANT_OWNER },
      ]);

      const result = await resolveParentGrant('/user/alice/memo/');
      expect(result).toBe(GRANT_OWNER);
    });

    it('should return GRANT_USER_GROUP when page has user group grant', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/team/engineering', grant: GRANT_USER_GROUP },
      ]);

      const result = await resolveParentGrant('/team/engineering/');
      expect(result).toBe(GRANT_USER_GROUP);
    });
  });

  describe('ancestor path traversal', () => {
    it('should find closest ancestor grant when direct parent does not exist', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/tech-notes/React', grant: GRANT_PUBLIC },
      ]);

      const result = await resolveParentGrant(
        '/tech-notes/React/state-management/',
      );
      expect(result).toBe(GRANT_PUBLIC);
    });

    it('should find grant from deeply nested ancestor', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/a', grant: GRANT_USER_GROUP },
      ]);

      const result = await resolveParentGrant('/a/b/c/d/');
      expect(result).toBe(GRANT_USER_GROUP);
    });

    it('should find root page grant when no intermediate ancestor exists', async () => {
      mocks.leanMock.mockResolvedValue([{ path: '/', grant: GRANT_PUBLIC }]);

      const result = await resolveParentGrant('/nonexistent/deep/');
      expect(result).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when no ancestor exists at any level', async () => {
      mocks.leanMock.mockResolvedValue([]);

      const result = await resolveParentGrant('/nonexistent/deep/path/');
      expect(result).toBe(GRANT_OWNER);
    });

    it('should prefer closest ancestor when multiple ancestors exist', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/tech-notes', grant: GRANT_PUBLIC },
        { path: '/tech-notes/React/hooks', grant: GRANT_USER_GROUP },
      ]);

      const result = await resolveParentGrant('/tech-notes/React/hooks/');
      expect(result).toBe(GRANT_USER_GROUP);
    });
  });

  describe('when no ancestor page exists', () => {
    it('should return GRANT_OWNER (4) as safe default', async () => {
      mocks.leanMock.mockResolvedValue([]);

      const result = await resolveParentGrant('/memo/bob/');
      expect(result).toBe(GRANT_OWNER);
    });
  });

  describe('query optimization', () => {
    it('should use a single $in query instead of multiple findOne calls', async () => {
      mocks.leanMock.mockResolvedValue([{ path: '/a', grant: GRANT_PUBLIC }]);

      await resolveParentGrant('/a/b/c/d/');

      expect(mocks.findMock).toHaveBeenCalledTimes(1);
      expect(mocks.findMock).toHaveBeenCalledWith({
        path: { $in: ['/a/b/c/d', '/a/b/c', '/a/b', '/a', '/'] },
      });
    });

    it('should select only path and grant fields', async () => {
      mocks.leanMock.mockResolvedValue([]);

      await resolveParentGrant('/tech-notes/');

      expect(mocks.selectMock).toHaveBeenCalledWith('path grant');
    });
  });

  describe('path normalization', () => {
    it('should strip trailing slash for database lookup', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/tech-notes', grant: GRANT_PUBLIC },
      ]);

      await resolveParentGrant('/tech-notes/');
      expect(mocks.findMock).toHaveBeenCalledWith({
        path: { $in: ['/tech-notes', '/'] },
      });
    });

    it('should handle path without trailing slash', async () => {
      mocks.leanMock.mockResolvedValue([
        { path: '/tech-notes', grant: GRANT_PUBLIC },
      ]);

      await resolveParentGrant('/tech-notes');
      expect(mocks.findMock).toHaveBeenCalledWith({
        path: { $in: ['/tech-notes', '/'] },
      });
    });

    it('should handle root path', async () => {
      mocks.leanMock.mockResolvedValue([{ path: '/', grant: GRANT_PUBLIC }]);

      await resolveParentGrant('/');
      expect(mocks.findMock).toHaveBeenCalledWith({
        path: { $in: ['/'] },
      });
    });
  });
});
