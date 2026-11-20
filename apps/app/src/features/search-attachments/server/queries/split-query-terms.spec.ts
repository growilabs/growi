import type { QueryTerms } from '~/server/interfaces/search';

import { hasPositiveKeyword, splitQueryTerms } from './split-query-terms';

const terms: QueryTerms = {
  match: ['minutes'],
  not_match: ['draft'],
  phrase: ['"weekly report"'],
  not_phrase: ['"old report"'],
  prefix: ['/team/'],
  not_prefix: ['/user'],
  tag: ['meeting'],
  not_tag: ['archived'],
  author: ['jim'],
  not_author: ['bob'],
  editor: ['amy'],
  not_editor: ['eve'],
  group: ['dev'],
  not_group: ['ops'],
};

describe('splitQueryTerms', () => {
  it('puts only the free-text terms on the keyword side and every operator on the filter side', () => {
    const { keywords, filters } = splitQueryTerms(terms);

    expect(keywords).toEqual({
      match: ['minutes'],
      not_match: ['draft'],
      phrase: ['"weekly report"'],
      not_phrase: ['"old report"'],
    });
    expect(filters).toEqual({
      prefix: ['/team/'],
      not_prefix: ['/user'],
      tag: ['meeting'],
      not_tag: ['archived'],
      author: ['jim'],
      not_author: ['bob'],
      editor: ['amy'],
      not_editor: ['eve'],
      group: ['dev'],
      not_group: ['ops'],
    });
  });

  it('puts every key of the terms on exactly one side', () => {
    const { keywords, filters } = splitQueryTerms(terms);
    const keys = [...Object.keys(keywords), ...Object.keys(filters)];

    expect(keys.sort()).toEqual(Object.keys(terms).sort());
  });
});

describe('hasPositiveKeyword', () => {
  it.each([
    [{ match: ['a'], not_match: [], phrase: [], not_phrase: [] }, true],
    [{ match: [], not_match: [], phrase: ['"a b"'], not_phrase: [] }, true],
    [{ match: [], not_match: ['a'], phrase: [], not_phrase: ['"b"'] }, false],
    [{ match: [], not_match: [], phrase: [], not_phrase: [] }, false],
  ])('%j -> %s', (keywords, expected) => {
    expect(hasPositiveKeyword(keywords)).toBe(expected);
  });
});
