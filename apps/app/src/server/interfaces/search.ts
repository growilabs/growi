import type { SearchDelegatorName } from '~/interfaces/named-query';
import type { ISearchResult } from '~/interfaces/search';

export type QueryTerms = {
  match: string[];
  not_match: string[];
  phrase: string[];
  not_phrase: string[];
  prefix: string[];
  not_prefix: string[];
  tag: string[];
  not_tag: string[];
  author: string[];
  not_author: string[];
  editor: string[];
  not_editor: string[];
  group: string[];
  not_group: string[];
};

export type ParsedQuery = {
  queryString: string;
  terms: QueryTerms;
  delegatorName?: string;
};

export interface SearchQueryParser {
  parseSearchQuery(
    queryString: string,
    nqName: string | null,
  ): Promise<ParsedQuery>;
}

export interface SearchResolver {
  resolve(
    parsedQuery: ParsedQuery,
  ): Promise<[SearchDelegator, SearchableData | null]>;
}

export interface SearchDelegator<
  T = unknown,
  KEY extends AllTermsKey = AllTermsKey,
  QTERMS = QueryTerms,
> {
  name?: SearchDelegatorName;
  search(
    data: SearchableData | null,
    user,
    userGroups,
    option,
  ): Promise<ISearchResult<T>>;
  isTermsNormalized(terms: Partial<QueryTerms>): terms is Partial<QTERMS>;
  validateTerms(terms: QueryTerms): UnavailableTermsKey<KEY>[];
}

export type SearchableData<T = Partial<QueryTerms>> = {
  queryString: string;
  terms: T;
  resolvedFilterData?: ResolvedFilterData;
};

export type UpdateOrInsertPagesOpts = {
  shouldEmitProgress?: boolean;
  invokeGarbageCollection?: boolean;
};

// Terms Key types
export type AllTermsKey = keyof QueryTerms;
export type UnavailableTermsKey<K extends AllTermsKey> = Exclude<
  AllTermsKey,
  K
>;
// NOTE: author/editor/group are declared here but are NOT yet runtime-enabled —
// AVAILABLE_KEYS in elasticsearch.ts (the runtime gate) intentionally still stops
// at not_tag, so using these filters currently throws SearchError. They are wired
// in later stories (author/editor → indexed username fields; group → resolved
// member usernames), which also relaxes the delegator registry typing in
// search.ts so ESTermsKey can become an honest subset of AllTermsKey.
export type ESTermsKey =
  | 'match'
  | 'not_match'
  | 'phrase'
  | 'not_phrase'
  | 'prefix'
  | 'not_prefix'
  | 'tag'
  | 'not_tag'
  | 'author'
  | 'not_author'
  | 'editor'
  | 'not_editor'
  | 'group'
  | 'not_group';
export type MongoTermsKey = 'match' | 'not_match' | 'prefix' | 'not_prefix';

// Query Terms types
export type ESQueryTerms = Pick<QueryTerms, ESTermsKey>;
export type MongoQueryTerms = Pick<QueryTerms, MongoTermsKey>;

// Holds filter values that require server-side resolution before being turned
// into delegator query criteria. `editor:` is intentionally absent: it is
// resolved directly against the dedicated `lastUpdatedUser` search index field
// (see PR #11061), so it needs no page-id resolution here.
export type ResolvedFilterData = {
  groupMemberUsernames: string[];
  notGroupMemberUsernames: string[];
};
