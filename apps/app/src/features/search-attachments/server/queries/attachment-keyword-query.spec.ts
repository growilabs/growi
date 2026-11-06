import { buildAttachmentKeywordClauses } from './attachment-keyword-query';
import { EMPTY_ATTACHMENT_KEYWORD_TERMS } from './split-query-terms';

describe('buildAttachmentKeywordClauses', () => {
  it('matches the joined match terms and excludes the not_match terms', () => {
    const clauses = buildAttachmentKeywordClauses({
      ...EMPTY_ATTACHMENT_KEYWORD_TERMS,
      match: ['minutes', 'weekly'],
      not_match: ['draft'],
    });

    expect(clauses.must).toEqual([
      {
        multi_match: expect.objectContaining({
          query: 'minutes weekly',
          type: 'most_fields',
        }),
      },
    ]);
    expect(clauses.must_not).toEqual([
      { multi_match: expect.objectContaining({ query: 'draft' }) },
    ]);
  });

  it('requires each phrase and excludes each negated phrase as a phrase query', () => {
    const clauses = buildAttachmentKeywordClauses({
      ...EMPTY_ATTACHMENT_KEYWORD_TERMS,
      phrase: ['"weekly report"', '"q3"'],
      not_phrase: ['"old report"'],
    });

    expect(clauses.must.map((c) => c.multi_match)).toEqual([
      expect.objectContaining({ query: '"weekly report"', type: 'phrase' }),
      expect.objectContaining({ query: '"q3"', type: 'phrase' }),
    ]);
    expect(clauses.must_not.map((c) => c.multi_match)).toEqual([
      expect.objectContaining({ query: '"old report"', type: 'phrase' }),
    ]);
  });

  it('builds no clause for empty terms', () => {
    expect(
      buildAttachmentKeywordClauses(EMPTY_ATTACHMENT_KEYWORD_TERMS),
    ).toEqual({ must: [], must_not: [] });
  });
});
