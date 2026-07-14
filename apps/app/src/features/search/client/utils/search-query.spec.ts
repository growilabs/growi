import {
  buildSearchQuery,
  createEmptyFilterState,
  isFilterStateEmpty,
  parseSearchQuery,
  type SearchFilterState,
} from './search-query';

const filterState = (
  overrides: Partial<SearchFilterState> = {},
): SearchFilterState => ({
  ...createEmptyFilterState(),
  ...overrides,
});

describe('buildSearchQuery', () => {
  it('returns just the keyword when there are no filters', () => {
    expect(buildSearchQuery('release notes', filterState())).toBe(
      'release notes',
    );
  });

  it('returns just the filter terms when the keyword is empty', () => {
    expect(buildSearchQuery('', filterState({ authors: ['alice'] }))).toBe(
      'author:alice',
    );
  });

  it('appends filter terms after the keyword in field order', () => {
    const query = buildSearchQuery(
      'checklist',
      filterState({
        authors: ['alice'],
        editors: ['bob'],
        groups: ['Docs'],
        tags: ['release-notes'],
      }),
    );
    expect(query).toBe(
      'checklist author:alice editor:bob group:Docs tag:release-notes',
    );
  });

  it('quotes a filter value that contains whitespace', () => {
    expect(buildSearchQuery('', filterState({ groups: ['dev team'] }))).toBe(
      'group:"dev team"',
    );
  });

  it('emits one operator per value for multi-select fields, preserving order', () => {
    expect(
      buildSearchQuery('', filterState({ authors: ['alice', 'bob'] })),
    ).toBe('author:alice author:bob');
  });

  it('skips empty or whitespace-only values so no bare operator is produced', () => {
    expect(
      buildSearchQuery('', filterState({ authors: ['', '   ', 'alice'] })),
    ).toBe('author:alice');
  });

  it('strips embedded double-quotes from a value (the grammar cannot escape them)', () => {
    expect(buildSearchQuery('', filterState({ groups: ['a"b'] }))).toBe(
      'group:ab',
    );
  });

  it('trims and collapses whitespace in the keyword', () => {
    expect(buildSearchQuery('  release   notes  ', filterState())).toBe(
      'release notes',
    );
  });

  it('returns an empty string when nothing is set', () => {
    expect(buildSearchQuery('', filterState())).toBe('');
  });
});

describe('parseSearchQuery', () => {
  it('treats a plain string as keyword with no filters', () => {
    expect(parseSearchQuery('release notes')).toEqual({
      keyword: 'release notes',
      filters: filterState(),
    });
  });

  it('extracts a single operator and leaves the keyword empty', () => {
    expect(parseSearchQuery('author:alice')).toEqual({
      keyword: '',
      filters: filterState({ authors: ['alice'] }),
    });
  });

  it('unwraps a quoted value that contains spaces', () => {
    expect(parseSearchQuery('group:"dev team"')).toEqual({
      keyword: '',
      filters: filterState({ groups: ['dev team'] }),
    });
  });

  it('recovers the keyword regardless of where filters appear', () => {
    expect(parseSearchQuery('author:alice hello world tag:x')).toEqual({
      keyword: 'hello world',
      filters: filterState({ authors: ['alice'], tags: ['x'] }),
    });
  });

  it('collects multiple values for the same field in order', () => {
    expect(parseSearchQuery('author:alice author:bob')).toEqual({
      keyword: '',
      filters: filterState({ authors: ['alice', 'bob'] }),
    });
  });

  it('passes negated operators through as keyword (UI does not own negation)', () => {
    expect(parseSearchQuery('-author:bob report')).toEqual({
      keyword: '-author:bob report',
      filters: filterState(),
    });
  });

  it('keeps prefix: and phrases in the keyword (UI owns none of these)', () => {
    expect(parseSearchQuery('prefix:/docs "exact phrase" tag:wiki')).toEqual({
      keyword: 'prefix:/docs "exact phrase"',
      filters: filterState({ tags: ['wiki'] }),
    });
  });

  it('strips a stray quote from a malformed unquoted value, matching the server', () => {
    expect(parseSearchQuery('author:"unclosed')).toEqual({
      keyword: '',
      filters: filterState({ authors: ['unclosed'] }),
    });
  });

  it('reinterprets operator syntax typed into the keyword as a filter', () => {
    // Documents the intentional non-round-trip case: a hand-typed operator
    // hydrates the matching chip rather than staying free text.
    expect(parseSearchQuery('author:alice')).toEqual({
      keyword: '',
      filters: filterState({ authors: ['alice'] }),
    });
  });
});

describe('round-trip', () => {
  const cases: Array<{
    name: string;
    keyword: string;
    filters: SearchFilterState;
  }> = [
    { name: 'keyword only', keyword: 'release notes', filters: filterState() },
    {
      name: 'filters only',
      keyword: '',
      filters: filterState({ authors: ['alice'] }),
    },
    {
      name: 'value with spaces',
      keyword: 'checklist',
      filters: filterState({ groups: ['dev team'] }),
    },
    {
      name: 'all fields with multiples',
      keyword: 'weekly report',
      filters: filterState({
        authors: ['alice', 'bob'],
        editors: ['carol'],
        groups: ['Docs', 'dev team'],
        tags: ['release-notes', 'wiki'],
      }),
    },
  ];

  it.each(
    cases,
  )('parseSearchQuery(buildSearchQuery(...)) recovers the input: $name', ({
    keyword,
    filters,
  }) => {
    expect(parseSearchQuery(buildSearchQuery(keyword, filters))).toEqual({
      keyword,
      filters,
    });
  });

  it('is idempotent on a canonical query string', () => {
    const canonical = 'weekly report author:alice group:"dev team" tag:wiki';
    const parsed = parseSearchQuery(canonical);
    const rebuilt = buildSearchQuery(parsed.keyword, parsed.filters);
    expect(rebuilt).toBe(canonical);
  });
});

describe('isFilterStateEmpty', () => {
  it('is true for a freshly created empty filter state', () => {
    expect(isFilterStateEmpty(createEmptyFilterState())).toBe(true);
  });

  it('is false when any field holds a value', () => {
    expect(isFilterStateEmpty(filterState({ tags: ['wiki'] }))).toBe(false);
    expect(isFilterStateEmpty(filterState({ authors: ['alice'] }))).toBe(false);
    expect(isFilterStateEmpty(filterState({ editors: ['bob'] }))).toBe(false);
    expect(isFilterStateEmpty(filterState({ groups: ['Docs'] }))).toBe(false);
  });
});
