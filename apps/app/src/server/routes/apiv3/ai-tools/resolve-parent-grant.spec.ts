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

  describe('when parent page does not exist', () => {
    it('should return GRANT_OWNER (4) as safe default', async () => {
      mocks.leanMock.mockResolvedValue(null);

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
