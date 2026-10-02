import type { SearchCandidate } from '../../interfaces/suggest-path-types';
import {
  extractTopLevelSegmentName,
  generateCategorySuggestion,
} from './generate-category-suggestion';

const mocks = vi.hoisted(() => {
  return {
    resolveParentGrantMock: vi.fn(),
  };
});

vi.mock('./resolve-parent-grant', () => ({
  resolveParentGrant: mocks.resolveParentGrantMock,
}));

const GRANT_PUBLIC = 1;
const GRANT_OWNER = 4;

function createCandidates(
  pages: { path: string; score: number }[],
): SearchCandidate[] {
  return pages.map((p) => ({
    pagePath: p.path,
    snippet: '',
    score: p.score,
  }));
}

describe('extractTopLevelSegmentName', () => {
  it('should extract segment name from nested path', () => {
    expect(extractTopLevelSegmentName('/tech-notes/React/hooks')).toBe(
      'tech-notes',
    );
  });

  it('should extract segment name from two-level path', () => {
    expect(extractTopLevelSegmentName('/tech-notes/React')).toBe('tech-notes');
  });

  it('should extract segment name from single-level path', () => {
    expect(extractTopLevelSegmentName('/tech-notes')).toBe('tech-notes');
  });

  it('should return null for root path', () => {
    expect(extractTopLevelSegmentName('/')).toBeNull();
  });
});

describe('generateCategorySuggestion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
  });

  describe('when candidates are provided', () => {
    it('should return a suggestion with type "category"', async () => {
      const candidates = createCandidates([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('category');
    });

    it('should extract top-level segment from top candidate path', async () => {
      const candidates = createCandidates([
        { path: '/tech-notes/React/hooks', score: 10 },
        { path: '/guides/TypeScript/basics', score: 8 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result?.path).toBe('/tech-notes/');
    });

    it('should return path with trailing slash', async () => {
      const candidates = createCandidates([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result?.path).toMatch(/\/$/);
    });

    it('should extract top-level even from deeply nested path', async () => {
      const candidates = createCandidates([
        { path: '/guides/a/b/c/d', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result?.path).toBe('/guides/');
    });

    it('should generate description from top-level segment name', async () => {
      const candidates = createCandidates([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result?.description).toBe('Top-level category: tech-notes');
    });

    it('should have label "Save under category"', async () => {
      const candidates = createCandidates([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result?.label).toBe('Save under category');
    });

    it('should resolve grant from top-level directory', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_PUBLIC);
      const candidates = createCandidates([
        { path: '/tech-notes/React/hooks', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(mocks.resolveParentGrantMock).toHaveBeenCalledWith('/tech-notes/');
      expect(result?.grant).toBe(GRANT_PUBLIC);
    });

    it('should return GRANT_OWNER when parent page not found', async () => {
      mocks.resolveParentGrantMock.mockResolvedValue(GRANT_OWNER);
      const candidates = createCandidates([
        { path: '/nonexistent/page', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result?.grant).toBe(GRANT_OWNER);
    });
  });

  describe('when top result is a single-segment page', () => {
    it('should return the page path as category', async () => {
      const candidates = createCandidates([
        { path: '/engineering', score: 10 },
      ]);

      const result = await generateCategorySuggestion(candidates);

      expect(result).not.toBeNull();
      expect(result?.path).toBe('/engineering/');
      expect(result?.description).toBe('Top-level category: engineering');
    });
  });

  describe('when candidates are empty', () => {
    it('should return null', async () => {
      const result = await generateCategorySuggestion([]);

      expect(result).toBeNull();
    });

    it('should not call resolveParentGrant', async () => {
      await generateCategorySuggestion([]);

      expect(mocks.resolveParentGrantMock).not.toHaveBeenCalled();
    });
  });
});
